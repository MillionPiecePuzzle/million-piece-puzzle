import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { Redis } from "ioredis";
import {
  TokenBucket,
  IpRegistry,
  RedisFixedWindow,
  clientIp,
  isAllowedOrigin,
  parseAllowedOrigins,
} from "./limits.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to capacity in a burst, then denies until refill", () => {
    const b = new TokenBucket(3, 10);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false);
  });

  it("refills at the configured rate", () => {
    const b = new TokenBucket(2, 10);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false);
    vi.setSystemTime(100);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false);
  });

  it("caps refill at capacity", () => {
    const b = new TokenBucket(2, 10);
    b.consume();
    b.consume();
    vi.setSystemTime(10_000);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(true);
    expect(b.consume()).toBe(false);
  });
});

describe("parseAllowedOrigins", () => {
  it("returns wildcard when unset", () => {
    expect(parseAllowedOrigins(undefined)).toEqual(["*"]);
  });
  it("returns wildcard when empty", () => {
    expect(parseAllowedOrigins("")).toEqual(["*"]);
    expect(parseAllowedOrigins("   ")).toEqual(["*"]);
  });
  it("splits and trims comma-separated origins", () => {
    expect(parseAllowedOrigins("http://a, http://b ,http://c")).toEqual([
      "http://a",
      "http://b",
      "http://c",
    ]);
  });
});

describe("IpRegistry", () => {
  it("shares one message-rate bucket across an IP's connections", () => {
    const reg = new IpRegistry(10, 2, 0);
    const a = reg.acquire("1.1.1.1");
    const b = reg.acquire("1.1.1.1");
    expect(a).toBe(b);
    // The shared budget is two tokens total, not two per connection: draining
    // it from one connection denies the other.
    expect(a!.consume()).toBe(true);
    expect(b!.consume()).toBe(true);
    expect(a!.consume()).toBe(false);
    expect(b!.consume()).toBe(false);
  });

  it("gives different IPs independent buckets", () => {
    const reg = new IpRegistry(10, 5, 0);
    expect(reg.acquire("1.1.1.1")).not.toBe(reg.acquire("2.2.2.2"));
  });

  it("refuses connections past the per-IP cap regardless of session count", () => {
    const reg = new IpRegistry(2, 5, 0);
    expect(reg.acquire("1.1.1.1")).not.toBeNull();
    expect(reg.acquire("1.1.1.1")).not.toBeNull();
    expect(reg.acquire("1.1.1.1")).toBeNull();
    expect(reg.acquire("1.1.1.1")).toBeNull();
  });

  it("frees a slot on release so the IP can reconnect", () => {
    const reg = new IpRegistry(1, 5, 0);
    expect(reg.acquire("1.1.1.1")).not.toBeNull();
    expect(reg.acquire("1.1.1.1")).toBeNull();
    reg.release("1.1.1.1");
    expect(reg.acquire("1.1.1.1")).not.toBeNull();
  });

  it("deletes the entry when the last connection closes", () => {
    const reg = new IpRegistry(2, 5, 0);
    reg.acquire("1.1.1.1");
    reg.acquire("1.1.1.1");
    expect(reg.size()).toBe(1);
    reg.release("1.1.1.1");
    expect(reg.size()).toBe(1);
    reg.release("1.1.1.1");
    expect(reg.size()).toBe(0);
  });

  it("leaves no entry behind when a refused acquire creates one", () => {
    const reg = new IpRegistry(0, 5, 0);
    expect(reg.acquire("1.1.1.1")).toBeNull();
    expect(reg.size()).toBe(0);
  });
});

function fakeRequest(headers: Record<string, string | string[]>, remoteAddress?: string) {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe("clientIp", () => {
  it("prefers the CF-Connecting-IP header over the socket address", () => {
    const req = fakeRequest({ "cf-connecting-ip": "203.0.113.7" }, "172.16.0.1");
    expect(clientIp(req, false)).toBe("203.0.113.7");
    expect(clientIp(req, true)).toBe("203.0.113.7");
  });

  it("takes the first value when the header is an array", () => {
    const req = fakeRequest({ "cf-connecting-ip": ["203.0.113.7", "10.0.0.1"] });
    expect(clientIp(req, false)).toBe("203.0.113.7");
  });

  it("trims the header and treats blank as absent", () => {
    expect(clientIp(fakeRequest({ "cf-connecting-ip": "  203.0.113.7 " }), false)).toBe(
      "203.0.113.7",
    );
    expect(clientIp(fakeRequest({ "cf-connecting-ip": "   " }, "172.16.0.1"), true)).toBe(
      "172.16.0.1",
    );
  });

  it("falls back to the socket address in dev when no CF header is present", () => {
    expect(clientIp(fakeRequest({}, "127.0.0.1"), true)).toBe("127.0.0.1");
    expect(clientIp(fakeRequest({}), true)).toBe("unknown");
  });

  it("buckets header-less production traffic under a shared unknown key", () => {
    expect(clientIp(fakeRequest({}, "172.16.0.1"), false)).toBe("unknown");
  });
});

function fakeRedis() {
  const counts = new Map<string, number>();
  const incr = vi.fn(async (key: string) => {
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next;
  });
  const expire = vi.fn(async () => 1);
  return { redis: { incr, expire } as unknown as Redis, incr, expire, counts };
}

describe("RedisFixedWindow", () => {
  it("allows up to max within the window, then denies", async () => {
    const { redis } = fakeRedis();
    const w = new RedisFixedWindow(redis, "auth", 2, 60);
    expect(await w.allow("1.1.1.1")).toBe(true);
    expect(await w.allow("1.1.1.1")).toBe(true);
    expect(await w.allow("1.1.1.1")).toBe(false);
  });

  it("sets the TTL only on the first hit of the window", async () => {
    const { redis, expire } = fakeRedis();
    const w = new RedisFixedWindow(redis, "auth", 5, 60);
    await w.allow("1.1.1.1");
    await w.allow("1.1.1.1");
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith("ratelimit:auth:1.1.1.1", 60);
  });

  it("keys windows by bucket and ip independently", async () => {
    const { redis } = fakeRedis();
    const auth = new RedisFixedWindow(redis, "auth", 1, 60);
    const signup = new RedisFixedWindow(redis, "signup", 1, 60);
    expect(await auth.allow("1.1.1.1")).toBe(true);
    expect(await auth.allow("2.2.2.2")).toBe(true);
    // Same ip but a different bucket has its own counter.
    expect(await signup.allow("1.1.1.1")).toBe(true);
    expect(await auth.allow("1.1.1.1")).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("accepts any origin when allowlist is wildcard", () => {
    expect(isAllowedOrigin("http://evil.example", ["*"])).toBe(true);
    expect(isAllowedOrigin(undefined, ["*"])).toBe(true);
  });
  it("rejects missing origin when allowlist is strict", () => {
    expect(isAllowedOrigin(undefined, ["http://a"])).toBe(false);
    expect(isAllowedOrigin("", ["http://a"])).toBe(false);
  });
  it("accepts an exact match", () => {
    expect(isAllowedOrigin("http://a", ["http://a", "http://b"])).toBe(true);
  });
  it("rejects an unlisted origin", () => {
    expect(isAllowedOrigin("http://c", ["http://a", "http://b"])).toBe(false);
  });
});
