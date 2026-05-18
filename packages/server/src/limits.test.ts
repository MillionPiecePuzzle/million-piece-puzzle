import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TokenBucket, isAllowedOrigin, parseAllowedOrigins } from "./limits.js";

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
