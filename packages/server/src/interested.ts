// Public "interested" counter for the landing page. Each opt-in IP is HMAC-hashed
// and SADDed to a per-puzzle Redis SET, so the set holds no raw IPs at rest (it has
// no TTL, unlike the per-IP rate-limit keys). The count is the set cardinality
// (SCARD), inherently unique per IP with no separate counter, and "me" is a
// membership check (SISMEMBER). See DECISIONS: interested SADD/SCARD dedup with a
// hashed IP.

import { createHmac } from "node:crypto";
import type { Redis } from "ioredis";
import * as keys from "./redis/keys.js";

export type InterestedStatus = { count: number; me: boolean };

export class RedisInterested {
  constructor(
    private readonly redis: Redis,
    private readonly puzzleId: string,
    private readonly salt: string,
  ) {}

  // HMAC keyed by the deployment secret with a context-tagged message, so the
  // digest is irreversible without the key and cannot be reused across features.
  private hash(ip: string): string {
    return createHmac("sha256", this.salt).update(`interested:${ip}`).digest("hex");
  }

  async add(ip: string): Promise<{ count: number; me: true }> {
    const key = keys.interested(this.puzzleId);
    await this.redis.sadd(key, this.hash(ip));
    const count = await this.redis.scard(key);
    return { count, me: true };
  }

  async status(ip: string): Promise<InterestedStatus> {
    const key = keys.interested(this.puzzleId);
    const [count, member] = await Promise.all([
      this.redis.scard(key),
      this.redis.sismember(key, this.hash(ip)),
    ]);
    return { count, me: member === 1 };
  }
}
