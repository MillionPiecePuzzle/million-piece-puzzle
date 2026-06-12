import { describe, it, expect } from "vitest";
import type { Redis } from "ioredis";
import { EventLog } from "./eventLog.js";

// Minimal in-memory Redis stream faithful to the id and range semantics the
// EventLog relies on: auto ids are `<ms>-<n>` from a controllable clock,
// XRANGE treats an incomplete (ms-only) id as `-0` for the start and `-max` for
// the end, XREVRANGE returns the tail, and XTRIM MINID drops by ms.
class FakeStreamRedis {
  clock = 0;
  private entries: { ms: number; seq: number; id: string; fields: string[] }[] = [];

  async xadd(_key: string, _star: string, ...fv: string[]): Promise<string> {
    const ms = this.clock;
    const prev = this.entries.length ? this.entries[this.entries.length - 1]! : null;
    const seq = prev && prev.ms === ms ? prev.seq + 1 : 0;
    const id = `${ms}-${seq}`;
    this.entries.push({ ms, seq, id, fields: fv });
    return id;
  }

  async xrange(_key: string, start: string, end: string): Promise<[string, string[]][]> {
    const lo = parseRangeId(start, false);
    const hi = parseRangeId(end, true);
    return this.entries
      .filter((e) => cmp(e.ms, e.seq, lo) >= 0 && cmp(e.ms, e.seq, hi) <= 0)
      .map((e) => [e.id, e.fields] as [string, string[]]);
  }

  async xrevrange(
    _key: string,
    _end: string,
    _start: string,
    _countToken: string,
    count: number,
  ): Promise<[string, string[]][]> {
    return this.entries
      .slice(-count)
      .reverse()
      .map((e) => [e.id, e.fields] as [string, string[]]);
  }

  async xtrim(_key: string, _minIdToken: string, minId: string): Promise<number> {
    const minMs = Number(minId.split("-")[0]);
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.ms >= minMs);
    return before - this.entries.length;
  }

  async del(_key: string): Promise<number> {
    const n = this.entries.length;
    this.entries = [];
    return n > 0 ? 1 : 0;
  }
}

function parseRangeId(s: string, isEnd: boolean): { ms: number; seq: number } {
  const dash = s.indexOf("-");
  if (dash < 0) return { ms: Number(s), seq: isEnd ? Number.MAX_SAFE_INTEGER : 0 };
  return { ms: Number(s.slice(0, dash)), seq: Number(s.slice(dash + 1)) };
}

function cmp(ms: number, seq: number, o: { ms: number; seq: number }): number {
  if (ms !== o.ms) return ms - o.ms;
  return seq - o.seq;
}

function makeLog(): { log: EventLog; redis: FakeStreamRedis } {
  const redis = new FakeStreamRedis();
  // Share the fake stream clock with the EventLog so trim's horizon and the
  // entry ids advance together.
  const log = new EventLog(redis as unknown as Redis, "p1", () => redis.clock);
  return { log, redis };
}

describe("EventLog.readWindow", () => {
  it("returns exactly the window's events in order, splitting on the window boundary", async () => {
    const { log, redis } = makeLog();
    const W = 3000;
    redis.clock = 1000;
    await log.recordDrop({ groupId: 7, worldX: 10, worldY: 20 });
    redis.clock = 2999;
    await log.recordSnap({
      at: 2999,
      mergeId: "m1",
      newGroupId: 3,
      addedPieceIds: [
        { id: 4, dx: 0, dy: 0 },
        { id: 5, dx: 1, dy: 0 },
      ],
      worldX: 0,
      worldY: 0,
      anchored: true,
      droppedSize: 2,
      mergedSize: 2,
      userId: "u1",
      pseudo: "alice",
      lockedCount: 2,
    });
    // ms 3000 falls in the next window, not the first one.
    redis.clock = 3000;
    await log.recordDrop({ groupId: 8, worldX: 30, worldY: 40 });
    redis.clock = 5000;
    await log.recordDrop({ groupId: 9, worldX: 50, worldY: 60 });

    const first = await log.readWindow(0, W);
    expect(first.map((e) => e.k)).toEqual(["drop", "snap"]);
    expect(first[0]!.groupId).toBe(7);
    expect(first[0]!.seq).toBe("1000-0");
    expect(first[1]!.k).toBe("snap");
    if (first[1]!.k === "snap")
      expect(first[1]!.addedPieceIds).toEqual([
        { id: 4, dx: 0, dy: 0 },
        { id: 5, dx: 1, dy: 0 },
      ]);

    const second = await log.readWindow(3000, W);
    expect(second.map((e) => e.k)).toEqual(["drop", "drop"]);
    expect(second[0]!.groupId).toBe(8);
    expect(second[1]!.groupId).toBe(9);
  });

  it("returns an empty array for a window with no events", async () => {
    const { log, redis } = makeLog();
    redis.clock = 100;
    await log.recordDrop({ groupId: 1, worldX: 0, worldY: 0 });
    expect(await log.readWindow(9000, 3000)).toEqual([]);
  });
});

describe("EventLog.head", () => {
  it("returns 0-0 on an empty stream and the last id otherwise", async () => {
    const { log, redis } = makeLog();
    expect(await log.head()).toBe("0-0");
    redis.clock = 1234;
    await log.recordDrop({ groupId: 1, worldX: 0, worldY: 0 });
    expect(await log.head()).toBe("1234-0");
  });
});

describe("EventLog.trim and clear", () => {
  it("trims entries older than the retention horizon", async () => {
    const { log, redis } = makeLog();
    redis.clock = 1000;
    await log.recordDrop({ groupId: 1, worldX: 0, worldY: 0 });
    redis.clock = 10000;
    await log.recordDrop({ groupId: 2, worldX: 0, worldY: 0 });
    // now = 10000, retention 5000 => MINID 5000 drops the ms=1000 entry.
    await log.trim(5000);
    const events = await log.readWindow(0, 12000);
    expect(events.map((e) => e.groupId)).toEqual([2]);
  });

  it("clear empties the stream", async () => {
    const { log, redis } = makeLog();
    redis.clock = 1000;
    await log.recordDrop({ groupId: 1, worldX: 0, worldY: 0 });
    await log.clear();
    expect(await log.head()).toBe("0-0");
    expect(await log.readWindow(0, 12000)).toEqual([]);
  });
});
