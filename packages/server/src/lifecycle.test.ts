import { describe, it, expect, vi } from "vitest";
import { PuzzleLifecycle, MERGE_LOG_CHUNK } from "./lifecycle.js";
import type { Context } from "./handlers.js";
import type { PuzzleMeta } from "./state.js";
import type { ClusterMergeDoc } from "./mongo.js";
import { GroupIndex } from "./groupIndex.js";
import { LockedPieceIndex } from "./lockedPieces.js";
import { replayMerges, type MergeRecord } from "./stateInvariants.js";
import { MinimapGridTracker, WORLD_TILE_SIZE, type ImageManifest, type PlayZone } from "@mpp/shared";

// PuzzleLifecycle's constructor runs real piece geometry generation off the
// manifest's own rows/cols (via playZoneForManifest), unrelated to
// forceComplete's chunking logic under test here, so this stays tiny.
// forceComplete itself reads ctx.meta.totalPieces, set independently per test.
const manifest: ImageManifest = {
  puzzleId: "test",
  name: "test",
  rows: 2,
  cols: 2,
  pieceSize: 100,
  margin: 35,
  tileSize: 170,
  premasked: true,
  borderBaked: true,
  source: { dzi: "source.dzi", width: 200, height: 200 },
  pieces: [],
};

const TEST_ZONE: PlayZone = { minX: -100000, minY: -100000, maxX: 100000, maxY: 100000 };

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start }, (_, i) => start + i);
}

function makeLifecycle(totalPieces: number, lockedCount: number) {
  const meta: PuzzleMeta = {
    totalPieces,
    gridRows: 1,
    gridCols: totalPieces,
    pieceSize: 100,
    snapTolerance: 10,
    generationSeed: "test-seed",
    status: "active",
    startedAt: 0,
  };
  const logMerge = vi.fn().mockResolvedValue(undefined);
  const addLockedCount = vi.fn().mockResolvedValue(0);
  const anchorAllGroups = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    hub: { allClients: () => [], resetSubscription: vi.fn(), send: vi.fn() },
    state: {
      anchorAllGroups,
      getLockedCount: vi.fn().mockResolvedValue(lockedCount),
      addLockedCount,
      writeMeta: vi.fn().mockResolvedValue(undefined),
      readAllGroupPoints: vi.fn().mockResolvedValue([]),
      readAllPieces: vi.fn().mockResolvedValue([]),
      readAllGroups: vi.fn().mockResolvedValue([]),
    },
    meta,
    puzzleId: "test",
    mongo: { logMerge },
    generationSeed: meta.generationSeed,
    groupIndex: new GroupIndex(WORLD_TILE_SIZE),
    lockedPieces: new LockedPieceIndex(
      meta.gridCols,
      meta.gridRows,
      meta.pieceSize,
      WORLD_TILE_SIZE,
      meta.totalPieces,
    ),
    minimapGrid: new MinimapGridTracker(meta.gridCols, meta.pieceSize, TEST_ZONE),
  } as unknown as Context;
  const lifecycle = new PuzzleLifecycle(ctx, manifest);
  return { lifecycle, ctx, logMerge, addLockedCount, anchorAllGroups };
}

describe("PuzzleLifecycle.forceComplete", () => {
  it("logs one merge doc when every piece fits in a single chunk", async () => {
    const { lifecycle, ctx, logMerge, addLockedCount } = makeLifecycle(7, 2);

    await lifecycle.forceComplete("user-1");

    expect(logMerge).toHaveBeenCalledTimes(1);
    const doc = logMerge.mock.calls[0]![0] as ClusterMergeDoc;
    expect(doc.droppedPieceIds).toEqual(range(0, 7));
    expect(doc.lockedPieceIds).toEqual(range(0, 7));
    expect(doc.addedPieceIds).toEqual([]);
    expect(doc.anchored).toBe(true);
    expect(doc.mergedSize).toBe(7);
    expect(doc.lockedDelta).toBe(5);
    expect(addLockedCount).toHaveBeenCalledWith(5);
    expect(ctx.meta.status).toBe("completed");
  });

  it("splits a board larger than MERGE_LOG_CHUNK into several docs covering every piece exactly once", async () => {
    const total = MERGE_LOG_CHUNK * 2 + 12400;
    const current = 40000;
    const remaining = total - current;
    const { lifecycle, ctx, logMerge, addLockedCount, anchorAllGroups } = makeLifecycle(
      total,
      current,
    );

    await lifecycle.forceComplete("user-1");

    const expectedChunkCount = Math.ceil(total / MERGE_LOG_CHUNK);
    expect(logMerge).toHaveBeenCalledTimes(expectedChunkCount);
    expect(anchorAllGroups).toHaveBeenCalledWith(total);
    expect(addLockedCount).toHaveBeenCalledWith(remaining);
    expect(ctx.meta.status).toBe("completed");

    const docs = logMerge.mock.calls.map(([doc]) => doc as ClusterMergeDoc);
    for (const doc of docs) {
      expect(doc.addedPieceIds).toEqual([]);
      expect(doc.anchored).toBe(true);
      expect(doc.mergedSize).toBe(doc.droppedPieceIds.length);
      expect(doc.droppedPieceIds).toEqual(doc.lockedPieceIds);
      expect(doc.targetAnchorPieceId).toBe(doc.droppedPieceIds[0]);
      expect(doc.lockedDelta).toBeGreaterThanOrEqual(0);
    }
    // One shared timestamp per call, mirroring seed-lock-scenario.ts: no piece
    // id repeats across chunks, so there is no ordering ambiguity for the
    // leaderboard's "first merge by `at`" attribution to resolve.
    expect(new Set(docs.map((d) => d.at.getTime())).size).toBe(1);

    // Every piece id is dropped/locked by exactly one chunk, in id order, with
    // no gaps or overlaps: the structural property leaderboard attribution
    // (droppedPieceIds) and the locked-set replay both depend on.
    const coveredIds = docs.flatMap((d) => d.droppedPieceIds);
    expect(coveredIds).toEqual(range(0, total));

    // The chunked lockedDelta values are a proportional split with no ground
    // truth for which specific ids were already locked (see forceComplete's
    // comment), so only their sum is a real contract; verify it against the
    // actual invariant replay (stateInvariants.ts), the same check
    // validate-state.ts runs against a live board.
    const merges: MergeRecord[] = docs.map((d) => ({
      addedPieceIds: d.addedPieceIds,
      targetAnchorPieceId: d.targetAnchorPieceId,
      anchored: d.anchored,
      lockedDelta: d.lockedDelta,
      lockedPieceIds: d.lockedPieceIds,
      at: d.at.getTime(),
    }));
    const replay = replayMerges(total, merges);
    expect(replay.lockedDeltaSum).toBe(remaining);
    expect(replay.lockedPieceIds).toEqual(new Set(range(0, total)));
  });

  it("locks nothing new when the board is already fully locked", async () => {
    const total = MERGE_LOG_CHUNK + 10;
    const { lifecycle, logMerge, addLockedCount } = makeLifecycle(total, total);

    await lifecycle.forceComplete("user-1");

    expect(addLockedCount).not.toHaveBeenCalled();
    const docs = logMerge.mock.calls.map(([doc]) => doc as ClusterMergeDoc);
    expect(docs.every((d) => d.lockedDelta === 0)).toBe(true);
    expect(docs.flatMap((d) => d.droppedPieceIds)).toEqual(range(0, total));
  });
});
