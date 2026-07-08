// Rate limiting and origin allowlisting for the WS server.
// See DECISIONS: backend-realtime WS hardening.

import type { IncomingMessage } from "node:http";
import type { Redis } from "ioredis";
import * as keys from "./redis/keys.js";

// Per-IP fixed-window counter backed by Redis: INCR the window key, set its TTL
// on the first hit of the window, allow while the count stays within `max`.
// Used for the auth routes and the public landing/queue guards, where a Redis
// counter stays correct even if the writer is later sharded, unlike the
// in-process TokenBucket the high-frequency WS path keeps. Over-budget callers
// get a 429.
export class RedisFixedWindow {
  constructor(
    private readonly redis: Redis,
    private readonly bucket: string,
    private readonly max: number,
    private readonly windowSec: number,
  ) {}

  async allow(ip: string): Promise<boolean> {
    const key = keys.rateLimit(this.bucket, ip);
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, this.windowSec);
    return count <= this.max;
  }
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  consume(n = 1): boolean {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
      this.lastRefill = now;
    }
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return ["*"];
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : ["*"];
}

export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 1 && allowed[0] === "*") return true;
  if (!origin) return false;
  return allowed.includes(origin);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

// Behind Cloudflare the real client IP is in CF-Connecting-IP; socket.remoteAddress
// is Cloudflare's edge. In dev there is no proxy, so the socket address is the
// client. A production request without CF-Connecting-IP did not arrive through the
// edge, so it is bucketed under a shared "unknown" key rather than trusting the
// (edge) socket address as a per-IP key.
export function clientIp(req: IncomingMessage, devEnabled: boolean): string {
  const cf = firstHeaderValue(req.headers["cf-connecting-ip"]);
  if (cf) return cf;
  if (devEnabled) return req.socket.remoteAddress ?? "unknown";
  return "unknown";
}

type IpEntry = {
  bucket: TokenBucket;
  connections: number;
};

// Shared per-IP budget across all of an IP's connections: one message-rate
// TokenBucket and a concurrent-connection count. The entry is created on the
// first connection and deleted when the last one closes, so the map only holds
// currently-connected IPs.
export class IpRegistry {
  private readonly entries = new Map<string, IpEntry>();

  constructor(
    private readonly maxConnectionsPerIp: number,
    private readonly rateBurst: number,
    private readonly rateTokensPerSec: number,
  ) {}

  // Registers a new connection for the IP and returns its shared message-rate
  // bucket, or null when the IP is already at its concurrent-connection cap. A
  // null return does not register the connection, so it must not be released.
  acquire(ip: string): TokenBucket | null {
    let entry = this.entries.get(ip);
    if (!entry) {
      entry = { bucket: new TokenBucket(this.rateBurst, this.rateTokensPerSec), connections: 0 };
      this.entries.set(ip, entry);
    }
    if (entry.connections >= this.maxConnectionsPerIp) {
      if (entry.connections === 0) this.entries.delete(ip);
      return null;
    }
    entry.connections += 1;
    return entry.bucket;
  }

  // Drops one connection for the IP, deleting the entry when none remain.
  release(ip: string): void {
    const entry = this.entries.get(ip);
    if (!entry) return;
    entry.connections -= 1;
    if (entry.connections <= 0) this.entries.delete(ip);
  }
}
