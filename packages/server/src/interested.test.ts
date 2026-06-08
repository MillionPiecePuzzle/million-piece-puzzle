import { describe, it, expect } from "vitest";
import type { Redis } from "ioredis";
import { RedisInterested } from "./interested.js";

// In-memory Redis SET stub: enough of SADD/SCARD/SISMEMBER to exercise the
// dedup-by-membership the count relies on.
function fakeRedisSet(): Redis {
  const sets = new Map<string, Set<string>>();
  const setOf = (key: string): Set<string> => {
    let s = sets.get(key);
    if (!s) {
      s = new Set();
      sets.set(key, s);
    }
    return s;
  };
  return {
    sadd: async (key: string, member: string) => {
      const s = setOf(key);
      const added = s.has(member) ? 0 : 1;
      s.add(member);
      return added;
    },
    scard: async (key: string) => setOf(key).size,
    sismember: async (key: string, member: string) => (setOf(key).has(member) ? 1 : 0),
  } as unknown as Redis;
}

describe("RedisInterested", () => {
  it("counts an IP once no matter how many times it opts in", async () => {
    const store = new RedisInterested(fakeRedisSet(), "p1", "salt");
    expect((await store.add("1.1.1.1")).count).toBe(1);
    expect((await store.add("1.1.1.1")).count).toBe(1);
    expect((await store.add("1.1.1.1")).count).toBe(1);
  });

  it("increments the count for each distinct IP", async () => {
    const store = new RedisInterested(fakeRedisSet(), "p1", "salt");
    expect((await store.add("1.1.1.1")).count).toBe(1);
    expect((await store.add("2.2.2.2")).count).toBe(2);
    expect((await store.add("3.3.3.3")).count).toBe(3);
  });

  it("reports me=true after opting in and me=false for a fresh IP", async () => {
    const store = new RedisInterested(fakeRedisSet(), "p1", "salt");
    await store.add("1.1.1.1");
    expect(await store.status("1.1.1.1")).toEqual({ count: 1, me: true });
    expect(await store.status("9.9.9.9")).toEqual({ count: 1, me: false });
  });

  it("scopes the set per puzzle", async () => {
    const redis = fakeRedisSet();
    const a = new RedisInterested(redis, "p1", "salt");
    const b = new RedisInterested(redis, "p2", "salt");
    await a.add("1.1.1.1");
    expect((await b.status("1.1.1.1")).count).toBe(0);
    expect((await b.status("1.1.1.1")).me).toBe(false);
  });

  it("stores a hashed IP, never the raw address", async () => {
    const seen: string[] = [];
    const redis = {
      sadd: async (_key: string, member: string) => {
        seen.push(member);
        return 1;
      },
      scard: async () => 1,
      sismember: async () => 0,
    } as unknown as Redis;
    const store = new RedisInterested(redis, "p1", "salt");
    await store.add("1.2.3.4");
    expect(seen[0]).not.toContain("1.2.3.4");
    expect(seen[0]).toMatch(/^[0-9a-f]{64}$/);
  });
});
