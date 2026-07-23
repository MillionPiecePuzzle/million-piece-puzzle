import { describe, it, expect } from "vitest";
import type { GroupRuntime } from "./piece.js";
import type { PlayZone } from "./playzone.js";
import { buildMinimapGrid, MinimapGridTracker, type GroupPositionState } from "./minimap.js";
import { mulberry32, seedFromString } from "./generator/prng.js";

const GRID_COLS = 4;
const PIECE_SIZE = 10;
const ZONE: PlayZone = { minX: -40, minY: -40, maxX: 80, maxY: 80 };

describe("buildMinimapGrid", () => {
  it("splits loose and locked counts", () => {
    const pieces = [
      { id: 0, groupId: 0, locked: true },
      { id: 1, groupId: 1, locked: false },
    ];
    const groups: GroupRuntime[] = [{ id: 1, worldX: 20, worldY: 0, size: 1, heldBy: null }];
    const grid = buildMinimapGrid(pieces, groups, GRID_COLS, PIECE_SIZE, ZONE);
    const sum = (a: number[]): number => a.reduce((s, v) => s + v, 0);
    expect(grid.cols * grid.rows).toBe(grid.loose.length);
    expect(grid.loose.length).toBe(grid.locked.length);
    expect(sum(grid.locked)).toBe(1);
    expect(sum(grid.loose)).toBe(1);
  });

  it("ignores a loose piece whose group is missing", () => {
    const pieces = [{ id: 0, groupId: 99, locked: false }];
    const grid = buildMinimapGrid(pieces, [], GRID_COLS, PIECE_SIZE, ZONE);
    expect(grid.loose.every((v) => v === 0)).toBe(true);
    expect(grid.locked.every((v) => v === 0)).toBe(true);
  });
});

describe("MinimapGridTracker", () => {
  it("rebuildFromBoard matches a from-scratch buildMinimapGrid", () => {
    const pieces = [
      { id: 0, groupId: 0, locked: true },
      { id: 1, groupId: 1, locked: false },
      { id: 2, groupId: 1, locked: false },
    ];
    const groups: GroupRuntime[] = [{ id: 1, worldX: 30, worldY: 10, size: 2, heldBy: null }];
    const expected = buildMinimapGrid(pieces, groups, GRID_COLS, PIECE_SIZE, ZONE);
    const tracker = new MinimapGridTracker(GRID_COLS, PIECE_SIZE, ZONE);
    tracker.rebuildFromBoard(pieces, groups);
    expect(tracker.snapshot()).toEqual(expected);
  });

  it("applyTranslation moves a group's pieces to their new cell", () => {
    const tracker = new MinimapGridTracker(GRID_COLS, PIECE_SIZE, ZONE);
    tracker.rebuildFromBoard(
      [{ id: 0, groupId: 0, locked: false }],
      [{ id: 0, worldX: 0, worldY: 0, size: 1, heldBy: null }],
    );
    const before = buildMinimapGrid(
      [{ id: 0, groupId: 0, locked: false }],
      [{ id: 0, worldX: 40, worldY: 0, size: 1, heldBy: null }],
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
      [{ id: 0, groupId: 0, locked: false }],
      [{ id: 0, worldX: 5, worldY: 5, size: 1, heldBy: null }],
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
      [{ id: 0, groupId: 0, locked: false }],
      [{ id: 0, worldX: 12, worldY: 12, size: 1, heldBy: null }],
    );
    tracker.applyTranslation(
      [0],
      { originX: 12, originY: 12, locked: false },
      { originX: 0, originY: 0, locked: true },
    );
    const expected = buildMinimapGrid(
      [{ id: 0, groupId: 0, locked: true }],
      [],
      GRID_COLS,
      PIECE_SIZE,
      ZONE,
    );
    expect(tracker.snapshot()).toEqual(expected);
  });

  // Drift check: a long random sequence of moves, anchors and merges, replayed
  // against both the tracker (incremental) and a from-scratch recompute
  // (authoritative) after every single step. Any divergence means the
  // incremental update disagrees with the board it is supposed to mirror.
  it("never drifts from a from-scratch recompute over a random operation sequence", () => {
    const rng = mulberry32(seedFromString("minimap-drift-check"));
    const totalPieces = 60;
    const gridCols = 8;

    // Only loose clusters are tracked as groups: a locked piece has no group to
    // grow (see DECISIONS: locked pieces stop being a group), so anchoring
    // always dissolves the source group into the flat lockedPieceIds set below,
    // whether it is a direct frame anchor or a merge onto an already-locked
    // neighbour. Both collapse to the same operation in the new model.
    type ModelGroup = { originX: number; originY: number; pieceIds: number[] };
    const groups = new Map<number, ModelGroup>();
    const lockedPieceIds = new Set<number>();
    for (let id = 0; id < totalPieces; id++) {
      groups.set(id, {
        originX: Math.floor(rng() * 100) - 50,
        originY: Math.floor(rng() * 100) - 50,
        pieceIds: [id],
      });
    }

    const tracker = new MinimapGridTracker(gridCols, PIECE_SIZE, ZONE);
    const modelToPieces = (): { id: number; groupId: number; locked: boolean }[] => [
      ...[...groups.entries()].flatMap(([groupId, g]) =>
        g.pieceIds.map((id) => ({ id, groupId, locked: false })),
      ),
      ...[...lockedPieceIds].map((id) => ({ id, groupId: -1, locked: true })),
    ];
    const modelToGroups = (): GroupRuntime[] =>
      [...groups.entries()].map(([id, g]) => ({
        id,
        worldX: g.originX,
        worldY: g.originY,
        size: g.pieceIds.length,
        heldBy: null,
      }));
    tracker.rebuildFromBoard(modelToPieces(), modelToGroups());

    const asState = (g: ModelGroup): GroupPositionState => ({
      originX: g.originX,
      originY: g.originY,
      locked: false,
    });

    for (let step = 0; step < 300; step++) {
      const ids = [...groups.keys()];
      const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

      const roll = rng();
      if (roll < 0.4 && ids.length > 0) {
        // Plain move: one loose group drifts to a new spot.
        const id = pick(ids);
        const g = groups.get(id)!;
        const from = asState(g);
        g.originX = Math.floor(rng() * 100) - 50;
        g.originY = Math.floor(rng() * 100) - 50;
        tracker.applyTranslation(g.pieceIds, from, asState(g));
      } else if (roll < 0.7 && ids.length > 0) {
        // Anchor: a loose group locks to the frame and dissolves.
        const id = pick(ids);
        const g = groups.get(id)!;
        const from = asState(g);
        const to: GroupPositionState = { originX: 0, originY: 0, locked: true };
        tracker.applyTranslation(g.pieceIds, from, to);
        for (const pid of g.pieceIds) lockedPieceIds.add(pid);
        groups.delete(id);
      } else if (ids.length >= 2) {
        // Loose-loose merge, snapping onto one side's existing origin (the
        // tolerance-bounded case: the "other" side may not have sat exactly
        // there, same as a real detectSnap target).
        const a = pick(ids);
        let b = pick(ids);
        while (b === a) b = pick(ids);
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
