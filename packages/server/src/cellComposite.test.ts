import { describe, it, expect } from "vitest";
import {
  allCellKeysForGrid,
  ancestorCellKey,
  cellKeyForGridId,
  CellCompositeIndex,
  collectRegionCellComposites,
  haloGridIdsForCell,
  parentCellKey,
} from "./cellComposite.js";
import { candidateGridIdsForCell } from "./lockedPieces.js";
import { cellKey, unpackCellKey } from "./worldGrid.js";

// Same fixture lockedPieces.test.ts uses: cellSize 325, pieceSize 32 does not
// divide evenly, so cx=0 owns cols 0-10, cx=1 owns cols 11-20, cx=2 owns
// cols 21-24 (clipped to the 25-col grid).
const GRID_COLS = 25;
const GRID_ROWS = 25;
const PIECE_SIZE = 32;
const CELL_SIZE = 325;

describe("haloGridIdsForCell", () => {
  it("widens the exact-ownership range by one piece on every side", () => {
    // A single-row grid keeps this 1D: cy=0 only ever owns row 0 (gridRows=1),
    // so widening never has anything to add on that axis, and the column
    // widening (the thing under test) is easy to read off directly.
    const oneRow = 1;
    const exact = candidateGridIdsForCell(1, 0, CELL_SIZE, GRID_COLS, oneRow, PIECE_SIZE);
    const halo = haloGridIdsForCell(1, 0, CELL_SIZE, GRID_COLS, oneRow, PIECE_SIZE);
    // cx=1 owns cols 11-20 (see candidateGridIdsForCell's own test); the halo
    // widens to cols 10-21, one piece into each neighbor.
    expect(exact.sort((a, b) => a - b)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(halo.sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  it("overlaps with an adjacent cell's halo by design, unlike exact ownership", () => {
    // candidateGridIdsForCell guarantees no overlap between neighbors; the
    // halo's whole purpose is the opposite: bleed one piece into each side so
    // a piece straddling the boundary bakes into both cells identically.
    const cell0 = haloGridIdsForCell(0, 0, CELL_SIZE, GRID_COLS, GRID_ROWS, PIECE_SIZE);
    const cell1 = haloGridIdsForCell(1, 0, CELL_SIZE, GRID_COLS, GRID_ROWS, PIECE_SIZE);
    const overlap = cell0.filter((id) => cell1.includes(id));
    expect(overlap.length).toBeGreaterThan(0);
  });

  it("clips the halo at the grid bounds instead of going negative or past the last id", () => {
    const firstCell = haloGridIdsForCell(0, 0, CELL_SIZE, GRID_COLS, GRID_ROWS, PIECE_SIZE);
    expect(Math.min(...firstCell.map((id) => id % GRID_COLS))).toBe(0);
    const lastCellCol = Math.floor(((GRID_COLS - 1) * PIECE_SIZE) / CELL_SIZE);
    const lastCell = haloGridIdsForCell(
      lastCellCol,
      0,
      CELL_SIZE,
      GRID_COLS,
      GRID_ROWS,
      PIECE_SIZE,
    );
    expect(Math.max(...lastCell.map((id) => id % GRID_COLS))).toBe(GRID_COLS - 1);
  });

  it("returns nothing for a cell entirely outside the grid, not a manufactured range", () => {
    expect(haloGridIdsForCell(10, 0, CELL_SIZE, GRID_COLS, GRID_ROWS, PIECE_SIZE)).toEqual([]);
  });
});

describe("cellKeyForGridId", () => {
  it("matches the cell a piece's world position falls into", () => {
    // Grid id 15 in a 25-col grid is (col 15, row 0), world x = 15*32 = 480,
    // which falls in cx = floor(480/325) = 1.
    expect(cellKeyForGridId(15, GRID_COLS, PIECE_SIZE, CELL_SIZE)).toBe(cellKey(1, 0));
  });

  it("maps every grid id in the same world cell to the same key", () => {
    const a = cellKeyForGridId(11, GRID_COLS, PIECE_SIZE, CELL_SIZE);
    const b = cellKeyForGridId(20, GRID_COLS, PIECE_SIZE, CELL_SIZE);
    expect(a).toBe(b);
    expect(a).toBe(cellKey(1, 0));
  });
});

describe("allCellKeysForGrid", () => {
  it("enumerates every cell that owns at least one piece, and no more", () => {
    const keys = allCellKeysForGrid(GRID_COLS, GRID_ROWS, PIECE_SIZE, CELL_SIZE);
    // 25x25 at this pieceSize/cellSize ratio owns a 3x3 block of cells (cx/cy
    // each range over {0, 1, 2}, see candidateGridIdsForCell's own tests).
    const expected: number[] = [];
    for (let cy = 0; cy < 3; cy++) {
      for (let cx = 0; cx < 3; cx++) expected.push(cellKey(cx, cy));
    }
    expect(keys.sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
  });
});

describe("CellCompositeIndex", () => {
  it("has no version for a cell until one is set", () => {
    const idx = new CellCompositeIndex();
    expect(idx.get(0, cellKey(0, 0))).toBeUndefined();
  });

  it("returns the version a cell was set to", () => {
    const idx = new CellCompositeIndex();
    idx.set(0, cellKey(0, 0), 3);
    expect(idx.get(0, cellKey(0, 0))).toBe(3);
  });

  it("keeps levels independent even when their packed cellKey coincides", () => {
    // (cx, cy) = (0, 0) packs to the same cellKey at every level; the index
    // must not let a level-1 write clobber level 0's own entry for it.
    const idx = new CellCompositeIndex();
    idx.set(0, cellKey(0, 0), 1);
    idx.set(1, cellKey(0, 0), 9);
    expect(idx.get(0, cellKey(0, 0))).toBe(1);
    expect(idx.get(1, cellKey(0, 0))).toBe(9);
  });

  it("rebuild replaces one level's map from persisted entries, leaving other levels untouched", () => {
    const idx = new CellCompositeIndex();
    idx.set(0, cellKey(0, 0), 1);
    idx.set(1, cellKey(5, 5), 7);
    idx.rebuild(0, [
      [cellKey(1, 0), 5],
      [cellKey(2, 0), 2],
    ]);
    expect(idx.get(0, cellKey(0, 0))).toBeUndefined();
    expect(idx.get(0, cellKey(1, 0))).toBe(5);
    expect(idx.get(0, cellKey(2, 0))).toBe(2);
    expect(idx.get(1, cellKey(5, 5))).toBe(7);
  });

  it("clear empties every level's map", () => {
    const idx = new CellCompositeIndex();
    idx.set(0, cellKey(0, 0), 1);
    idx.set(2, cellKey(3, 3), 4);
    idx.clear();
    expect(idx.get(0, cellKey(0, 0))).toBeUndefined();
    expect(idx.get(2, cellKey(3, 3))).toBeUndefined();
  });
});

describe("parentCellKey", () => {
  it("halves both coordinates", () => {
    expect(parentCellKey(4, 6)).toBe(cellKey(2, 3));
  });

  it("groups a 2x2 block of children under the same parent", () => {
    const parent = parentCellKey(0, 0);
    expect(parentCellKey(1, 0)).toBe(parent);
    expect(parentCellKey(0, 1)).toBe(parent);
    expect(parentCellKey(1, 1)).toBe(parent);
  });

  it("floors toward negative infinity, not toward zero, so negative pairs still group correctly", () => {
    expect(parentCellKey(-1, -1)).toBe(parentCellKey(-2, -2));
  });
});

describe("ancestorCellKey", () => {
  it("returns the key unchanged for 0 levels", () => {
    expect(ancestorCellKey(cellKey(4, 6), 0)).toBe(cellKey(4, 6));
  });

  it("matches one parentCellKey step at 1 level", () => {
    expect(ancestorCellKey(cellKey(4, 6), 1)).toBe(parentCellKey(4, 6));
  });

  it("matches repeated parentCellKey steps at higher levels", () => {
    const level1 = parentCellKey(20, 17);
    const { cx, cy } = unpackCellKey(level1);
    const level2 = parentCellKey(cx, cy);
    expect(ancestorCellKey(cellKey(20, 17), 2)).toBe(level2);
  });

  it("groups every level-0 descendant of a level-2 cell under the same ancestor", () => {
    // A level-2 cell spans a 4x4 block of level-0 cells (two halvings).
    const target = ancestorCellKey(cellKey(8, 12), 2);
    for (let dx = 0; dx < 4; dx++) {
      for (let dy = 0; dy < 4; dy++) {
        expect(ancestorCellKey(cellKey(8 + dx, 12 + dy), 2)).toBe(target);
      }
    }
  });
});

describe("collectRegionCellComposites", () => {
  it("includes a batch's own level-0 cells as-is when baked", () => {
    const idx = new CellCompositeIndex();
    idx.set(0, cellKey(0, 0), 3);
    idx.set(0, cellKey(1, 0), 5);
    const out = collectRegionCellComposites(idx, [cellKey(0, 0), cellKey(1, 0)], 0);
    expect(out.sort((a, b) => a.cellKey - b.cellKey)).toEqual([
      { cellKey: cellKey(0, 0), level: 0, version: 3 },
      { cellKey: cellKey(1, 0), level: 0, version: 5 },
    ]);
  });

  it("omits a (level, key) with no bake yet, rather than a zero or placeholder entry", () => {
    const idx = new CellCompositeIndex();
    const out = collectRegionCellComposites(idx, [cellKey(0, 0)], 0);
    expect(out).toEqual([]);
  });

  it("adds ancestor levels for the same batch, one entry per level per distinct ancestor", () => {
    const idx = new CellCompositeIndex();
    idx.set(0, cellKey(0, 0), 1);
    idx.set(0, cellKey(1, 0), 1);
    idx.set(1, parentCellKey(0, 0), 7);
    // (0,0) and (1,0) share the same level-1 parent, so the level-1 entry must
    // appear exactly once even though two of the batch's cells reach it.
    const out = collectRegionCellComposites(idx, [cellKey(0, 0), cellKey(1, 0)], 1);
    const level1Entries = out.filter((c) => c.level === 1);
    expect(level1Entries).toEqual([{ cellKey: parentCellKey(0, 0), level: 1, version: 7 }]);
  });

  it("walks every level from 0 to maxLevel, not just the finest and coarsest", () => {
    const idx = new CellCompositeIndex();
    const key0 = cellKey(4, 4);
    idx.set(0, key0, 1);
    idx.set(1, ancestorCellKey(key0, 1), 2);
    idx.set(2, ancestorCellKey(key0, 2), 3);
    idx.set(3, ancestorCellKey(key0, 3), 4);
    const out = collectRegionCellComposites(idx, [key0], 3);
    expect(out.map((c) => c.level).sort()).toEqual([0, 1, 2, 3]);
    expect(out.map((c) => c.version).sort()).toEqual([1, 2, 3, 4]);
  });
});
