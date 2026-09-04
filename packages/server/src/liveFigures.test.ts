import { describe, it, expect, vi } from "vitest";
import type { ActivityItem, LeaderboardEntry } from "@mpp/shared";
import {
  LiveFigures,
  LIVE_ACTIVITY_LIMIT,
  LIVE_CONTRIBUTORS_LIMIT,
  type LiveFiguresSource,
} from "./liveFigures.js";

const entries: LeaderboardEntry[] = [{ userId: "u1", pseudo: "Alice", country: "fr", pieces: 3 }];
const items: ActivityItem[] = [
  { id: "m1", userId: "u1", anchored: true, droppedSize: 2, mergedSize: 2, at: 1000 },
];

type SourceOpts = {
  status?: "active" | "completed";
  lockedCount?: () => Promise<number>;
};

function makeSource(opts: SourceOpts = {}) {
  const source: LiveFiguresSource = {
    totalPieces: () => 25,
    status: () => opts.status ?? "active",
    lockedCount: opts.lockedCount ?? vi.fn(async () => 10),
    leaderboard: vi.fn(async () => entries),
    activity: vi.fn(async () => items),
  };
  return source;
}

function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("LiveFigures", () => {
  it("carries the live figures, the puzzle status and the build stamp", async () => {
    const figures = new LiveFigures(2000, makeSource(), clock(1700).now);
    const body = await figures.read();
    expect(body).toEqual({
      figuresAt: 1700,
      status: "active",
      progress: { locked: 10, total: 25 },
      leaderboard: entries,
      activity: items,
    });
  });

  it("stamps every rebuild with the clock that closed it", async () => {
    const c = clock();
    const figures = new LiveFigures(2000, makeSource(), c.now);
    const first = await figures.read();
    c.advance(5000);
    const second = await figures.read();
    expect(first?.figuresAt).toBe(0);
    expect(second?.figuresAt).toBe(5000);
  });

  it("asks both sources for exactly what the landing renders", async () => {
    const source = makeSource();
    await new LiveFigures(2000, source).read();
    expect(source.leaderboard).toHaveBeenCalledWith(LIVE_CONTRIBUTORS_LIMIT);
    expect(source.activity).toHaveBeenCalledWith(LIVE_ACTIVITY_LIMIT);
  });

  it("serves the memo inside the window and rebuilds past it", async () => {
    const source = makeSource();
    const c = clock();
    const figures = new LiveFigures(2000, source, c.now);
    await figures.read();
    c.advance(1999);
    await figures.read();
    expect(source.lockedCount).toHaveBeenCalledTimes(1);
    c.advance(1);
    await figures.read();
    expect(source.lockedCount).toHaveBeenCalledTimes(2);
  });

  it("shares one rebuild between callers that arrive together", async () => {
    const source = makeSource();
    const figures = new LiveFigures(2000, source);
    const [a, b, c] = await Promise.all([figures.read(), figures.read(), figures.read()]);
    expect(source.lockedCount).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("keeps serving the last body when a rebuild fails, and retries on the next read", async () => {
    let fail = false;
    const lockedCount = vi.fn(async () => {
      if (fail) throw new Error("redis down");
      return 10;
    });
    const c = clock();
    const figures = new LiveFigures(2000, makeSource({ lockedCount }), c.now);
    const first = await figures.read();
    fail = true;
    c.advance(3000);
    expect(await figures.read()).toBe(first);
    fail = false;
    // The failed rebuild left the window open, so this read does not wait it out.
    expect((await figures.read())?.progress.locked).toBe(10);
    expect(lockedCount).toHaveBeenCalledTimes(3);
  });

  it("answers null while no build has ever succeeded", async () => {
    const figures = new LiveFigures(
      2000,
      makeSource({
        lockedCount: async () => {
          throw new Error("redis down");
        },
      }),
    );
    expect(await figures.read()).toBeNull();
  });
});
