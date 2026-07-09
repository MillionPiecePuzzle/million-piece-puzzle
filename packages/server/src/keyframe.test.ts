import { describe, it, expect, vi } from "vitest";
import type { ActivityItem, LeaderboardEntry, MinimapGrid } from "@mpp/shared";
import { KeyframePublisher, buildSnapshot, type KeyframeSource } from "./keyframe.js";

const leaderboardEntries: LeaderboardEntry[] = [{ userId: "u1", pieces: 3 }];
const activityItems: ActivityItem[] = [
  { id: "m1", userId: "u1", anchored: true, droppedSize: 2, mergedSize: 2, at: 1000 },
];
const grid: MinimapGrid = {
  cols: 1,
  rows: 1,
  originX: 0,
  originY: 0,
  cellW: 100,
  cellH: 100,
  loose: [1],
  locked: [1],
};

type SourceOpts = {
  status?: "active" | "completed";
  eventStartsAt?: number;
  getLockedCount?: () => Promise<number>;
};

function makeSource(opts: SourceOpts = {}): KeyframeSource {
  return {
    totalPieces: () => 2,
    eventStartsAt: () => opts.eventStartsAt ?? 0,
    status: () => opts.status ?? "active",
    getLockedCount: opts.getLockedCount ?? (async () => 1),
    leaderboard: async () => leaderboardEntries,
    activity: async () => activityItems,
    minimapGrid: () => grid,
  };
}

describe("buildSnapshot", () => {
  it("collects the live figures and standings", async () => {
    const snap = await buildSnapshot(makeSource());
    expect(snap.lockedCount).toBe(1);
    expect(snap.totalPieces).toBe(2);
    expect(snap.leaderboard).toEqual(leaderboardEntries);
    expect(snap.activity).toEqual(activityItems);
  });

  it("carries the minimap grid read from the source, with no board scan", async () => {
    const snap = await buildSnapshot(makeSource());
    expect(snap.minimapGrid).toEqual(grid);
  });
});

describe("KeyframePublisher idle gate", () => {
  it("builds once at boot, then skips while idle until forced", async () => {
    let reads = 0;
    const source = makeSource({
      status: "completed",
      getLockedCount: async () => {
        reads++;
        return 1;
      },
    });
    const pub = new KeyframePublisher(300000, source);
    await pub.regenerate();
    expect(reads).toBe(1);
    expect(pub.latest()).not.toBeNull();
    // Idle and a snapshot exists, so a normal tick reads nothing.
    await pub.regenerate();
    expect(reads).toBe(1);
    // Forced (reset/complete transition) bypasses the gate.
    await pub.regenerate(true);
    expect(reads).toBe(2);
  });

  it("regenerates on every tick while live", async () => {
    let reads = 0;
    const source = makeSource({
      status: "active",
      getLockedCount: async () => {
        reads++;
        return 1;
      },
    });
    const pub = new KeyframePublisher(300000, source);
    await pub.regenerate();
    await pub.regenerate();
    expect(reads).toBe(2);
  });

  it("keeps the previous snapshot when a regeneration throws", async () => {
    let calls = 0;
    const source = makeSource({
      getLockedCount: async () => {
        calls++;
        if (calls === 2) throw new Error("redis down");
        return 1;
      },
    });
    const pub = new KeyframePublisher(300000, source);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await pub.regenerate();
    const first = pub.latest();
    expect(first).not.toBeNull();
    await pub.regenerate();
    expect(pub.latest()).toBe(first);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
