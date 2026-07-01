import { describe, it, expect, vi } from "vitest";
import type { ActivityItem, GroupRuntime, LeaderboardEntry, PlayZone } from "@mpp/shared";
import type { RedisState, StoredPiece } from "./state.js";
import { KeyframePublisher, buildSnapshot, type KeyframeSource } from "./keyframe.js";

// Internal (grid-space) board: readAllPieces/readAllGroups return this; buildSnapshot
// computes the minimap grid and the scalar figures from it.
const pieces: StoredPiece[] = [
  { id: 0, groupId: 0, rotation: 0 },
  { id: 1, groupId: 1, rotation: 0 },
];
const groups: GroupRuntime[] = [
  { id: 0, worldX: 0, worldY: 0, size: 1, locked: true, heldBy: null },
  { id: 1, worldX: 80, worldY: 0, size: 1, locked: false, heldBy: null },
];
const leaderboardEntries: LeaderboardEntry[] = [{ userId: "u1", pieces: 3 }];
const activityItems: ActivityItem[] = [
  { id: "m1", userId: "u1", anchored: true, droppedSize: 2, mergedSize: 2, at: 1000 },
];
const zone: PlayZone = { minX: -100, minY: -100, maxX: 900, maxY: 900 };

type SourceOpts = {
  status?: "active" | "completed";
  eventStartsAt?: number;
  readAllPieces?: () => Promise<StoredPiece[]>;
};

function makeSource(opts: SourceOpts = {}): KeyframeSource {
  const state = {
    readAllPieces: opts.readAllPieces ?? (async () => pieces),
    readAllGroups: async () => groups,
    getLockedCount: async () => 1,
  };
  return {
    state: state as unknown as RedisState,
    totalPieces: () => 2,
    gridCols: () => 2,
    pieceSize: () => 80,
    playZone: () => zone,
    eventStartsAt: () => opts.eventStartsAt ?? 0,
    status: () => opts.status ?? "active",
    leaderboard: async () => leaderboardEntries,
    activity: async () => activityItems,
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

  it("includes a minimap grid binning the board into loose and locked counts", async () => {
    const snap = await buildSnapshot(makeSource());
    const grid = snap.minimapGrid;
    expect(grid.cols * grid.rows).toBe(grid.loose.length);
    expect(grid.loose.length).toBe(grid.locked.length);
    // Piece 0 is in the locked group, piece 1 in the loose group.
    const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
    expect(sum(grid.locked)).toBe(1);
    expect(sum(grid.loose)).toBe(1);
  });
});

describe("KeyframePublisher idle gate", () => {
  it("builds once at boot, then skips while idle until forced", async () => {
    let reads = 0;
    const source = makeSource({
      status: "completed",
      readAllPieces: async () => {
        reads++;
        return pieces;
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
      readAllPieces: async () => {
        reads++;
        return pieces;
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
      readAllPieces: async () => {
        calls++;
        if (calls === 2) throw new Error("redis down");
        return pieces;
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
