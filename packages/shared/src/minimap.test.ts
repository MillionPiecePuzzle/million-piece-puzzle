import { describe, it, expect } from "vitest";
import type { GroupRuntime } from "./piece.js";
import type { PlayZone } from "./playzone.js";
import { buildMinimapGrid, MinimapGridTracker, type GroupPositionState } from "./minimap.js";
import { mulberry32, seedFromString } from "./generator/prng.js";

const GRID_COLS = 4;
const PIECE_SIZE = 10;
const ZONE: PlayZone = { minX: -40, minY: -40, maxX: 80, maxY: 80 };

describe("buildMinimapGrid", () => {
  it("splits loose and locked counts by group", () => {
    const pieces = [
      { id: 0, groupId: 0 },
      { id: 1, groupId: 1 },
    ];
    const groups: GroupRuntime[] = [
      { id: 0, worldX: 0, worldY: 0, size: 1, locked: true, heldBy: null },
      { id: 1, worldX: 20, worldY: 0, size: 1, locked: false, heldBy: null },
    ];
    const grid = buildMinimapGrid(pieces, groups, GRID_COLS, PIECE_SIZE, ZONE);
    const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
    expect(grid.cols * grid.rows).toBe(grid.loose.length);
    expect(grid.loose.length).toBe(grid.locked.length);
    expect(sum(grid.locked)).toBe(1);
    expect(sum(grid.loose)).toBe(1);
  });

  it("ignores a piece whose group is missing", () => {
    const pieces = [{ id: 0, groupId: 99 }];
    const grid = buildMinimapGrid(pieces, [], GRID_COLS, PIECE_SIZE, ZONE);
    expect(grid.loose.every((v) => v === 0)).toBe(true);
    expect(grid.locked.every((v) => v === 0)).toBe(true);
  });
});

describe("MinimapGridTracker", () => {
  it("rebuildFromBoard matches a from-scratch buildMinimapGrid", () => {
    const pieces = [
      { id: 0, groupId: 0 },
      { id: 1, groupId: 1 },
      { id: 2, groupId: 1 },
    ];
    const groups: GroupRuntime[] = [
      { id: 0, worldX: 0, worldY: 0, size: 1, locked: true, heldBy: null },
      { id: 1, worldX: 30, worldY: 10, size: 2, locked: false, heldBy: null },
    ];
    const expected = buildMinimapGrid(pieces, groups, GRID_COLS, PIECE_SIZE, ZONE);
    const tracker = new MinimapGridTracker(GRID_COLS, PIECE_SIZE, ZONE);
    tracker.rebuildFromBoard(pieces, groups);
    expect(tracker.snapshot()).toEqual(expected);
  });

  it("applyTranslation moves a group's pieces to their new cell", () => {
    const tracker = new MinimapGridTracker(GRID_COLS, PIECE_SIZE, ZONE);
    tracker.rebuildFromBoard(
      [{ id: 0, groupId: 0 }],
      [{ id: 0, worldX: 0, worldY: 0, size: 1, locked: false, heldBy: null }],
    );
    const before = buildMinimapGrid(
      [{ id: 0, groupId: 0 }],
      [{ id: 0, worldX: 40, worldY: 0, size: 1, locked: false, heldBy: null }],
      GRID_COLS,
      PIECE_SIZE,
      ZONE,
    );
    tracker.applyTranslation(
      [0],
      { originX: 0, originY: 0, locked: false },
      { originX: 40, originY: 0, locked: false },
    );
    expect(tracker.snapshot()).toEqual(before);
  });

  it("is a no-op when origin and lock state are unchanged", () => {
    const tracker = new MinimapGridTracker(GRID_COLS, PIECE_SIZE, ZONE);
    tracker.rebuildFromBoard(
      [{ id: 0, groupId: 0 }],
      [{ id: 0, worldX: 5, worldY: 5, size: 1, locked: false, heldBy: null }],
    );
    const before = tracker.snapshot();
    tracker.applyTranslation(
      [0],
      { originX: 5, originY: 5, locked: false },
      { originX: 5, originY: 5, locked: false },
    );
    expect(tracker.snapshot()).toEqual(before);
  });

  it("moves a count from loose to locked on anchor", () => {
    const tracker = new MinimapGridTracker(GRID_COLS, PIECE_SIZE, ZONE);
    tracker.rebuildFromBoard(
      [{ id: 0, groupId: 0 }],
      [{ id: 0, worldX: 12, worldY: 12, size: 1, locked: false, heldBy: null }],
    );
    tracker.applyTranslation(
      [0],
      { originX: 12, originY: 12, locked: false },
      { originX: 0, originY: 0, locked: true },
    );
    const expected = buildMinimapGrid(
      [{ id: 0, groupId: 0 }],
      [{ id: 0, worldX: 0, worldY: 0, size: 1, locked: true, heldBy: null }],
      GRID_COLS,
      PIECE_SIZE,
      ZONE,
    );
    expect(tracker.snapshot()).toEqual(expected);
  });

  // Drift check: a long random sequence of moves and merges, replayed against
  // both the tracker (incremental) and a from-scratch recompute (authoritative)
  // after every single step. Any divergence means the incremental update
  // disagrees with the board it is supposed to mirror.
  it("never drifts from a from-scratch recompute over a random operation sequence", () => {
    const rng = mulberry32(seedFromString("minimap-drift-check"));
    const totalPieces = 60;
    const gridCols = 8;

    type ModelGroup = { originX: number; originY: number; locked: boolean; pieceIds: number[] };
    const groups = new Map<number, ModelGroup>();
    for (let id = 0; id < totalPieces; id++) {
      groups.set(id, {
        originX: Math.floor(rng() * 100) - 50,
        originY: Math.floor(rng() * 100) - 50,
        locked: false,
        pieceIds: [id],
      });
    }

    const tracker = new MinimapGridTracker(gridCols, PIECE_SIZE, ZONE);
    const modelToPieces = (): { id: number; groupId: number }[] =>
      [...groups.entries()].flatMap(([groupId, g]) => g.pieceIds.map((id) => ({ id, groupId })));
    const modelToGroups = (): GroupRuntime[] =>
      [...groups.entries()].map(([id, g]) => ({
        id,
        worldX: g.originX,
        worldY: g.originY,
        size: g.pieceIds.length,
        locked: g.locked,
        heldBy: null,
      }));
    tracker.rebuildFromBoard(modelToPieces(), modelToGroups());

    const asState = (g: ModelGroup): GroupPositionState => ({
      originX: g.originX,
      originY: g.originY,
      locked: g.locked,
    });

    for (let step = 0; step < 300; step++) {
      const ids = [...groups.keys()];
      const looseIds = ids.filter((id) => !groups.get(id)!.locked);
      const lockedId = ids.find((id) => groups.get(id)!.locked);
      const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

      const roll = rng();
      if (roll < 0.4 && looseIds.length > 0) {
        // Plain move: one loose group drifts to a new spot.
        const id = pick(looseIds);
        const g = groups.get(id)!;
        const from = asState(g);
        g.originX = Math.floor(rng() * 100) - 50;
        g.originY = Math.floor(rng() * 100) - 50;
        tracker.applyTranslation(g.pieceIds, from, asState(g));
      } else if (roll < 0.6 && lockedId !== undefined && looseIds.length > 0) {
        // Anchor-by-merge: a loose group joins the one locked cluster. Mirrors
        // applyMerge calling applyTranslation once per pre-merge group with its
        // own from-state; the already-locked side's call is a no-op, kept here
        // to exercise that path exactly as production does.
        const id = pick(looseIds);
        const g = groups.get(id)!;
        const target = groups.get(lockedId)!;
        const to: GroupPositionState = {
          originX: target.originX,
          originY: target.originY,
          locked: true,
        };
        tracker.applyTranslation(g.pieceIds, asState(g), to);
        tracker.applyTranslation(target.pieceIds, asState(target), to);
        target.pieceIds = [...target.pieceIds, ...g.pieceIds];
        groups.delete(id);
      } else if (roll < 0.75 && lockedId === undefined && looseIds.length > 0) {
        // Direct frame anchor: one loose group becomes the locked cluster.
        const id = pick(looseIds);
        const g = groups.get(id)!;
        const from = asState(g);
        g.originX = 0;
        g.originY = 0;
        g.locked = true;
        tracker.applyTranslation(g.pieceIds, from, asState(g));
      } else if (looseIds.length >= 2) {
        // Loose-loose merge, snapping onto one side's existing origin (the
        // tolerance-bounded case: the "other" side may not have sat exactly
        // there, same as a real detectSnap target).
        const a = pick(looseIds);
        let b = pick(looseIds);
        while (b === a) b = pick(looseIds);
        const target = groups.get(a)!;
        const other = groups.get(b)!;
        const to: GroupPositionState = {
          originX: target.originX,
          originY: target.originY,
          locked: false,
        };
        tracker.applyTranslation(target.pieceIds, asState(target), to);
        tracker.applyTranslation(other.pieceIds, asState(other), to);
        target.pieceIds = [...target.pieceIds, ...other.pieceIds];
        groups.delete(b);
      } else {
        continue;
      }

      const expected = buildMinimapGrid(
        modelToPieces(),
        modelToGroups(),
        gridCols,
        PIECE_SIZE,
        ZONE,
      );
      expect(tracker.snapshot()).toEqual(expected);
    }
  });
});
