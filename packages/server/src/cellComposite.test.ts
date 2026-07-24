import { describe, it, expect } from "vitest";
import {
  allCellKeysForGrid,
  cellKeyForGridId,
  CellCompositeIndex,
  haloGridIdsForCell,
} from "./cellComposite.js";
import { candidateGridIdsForCell } from "./lockedPieces.js";
import { cellKey } from "./worldGrid.js";

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
    expect(idx.get(cellKey(0, 0))).toBeUndefined();
  });

  it("returns the version a cell was set to", () => {
    const idx = new CellCompositeIndex();
    idx.set(cellKey(0, 0), 3);
    expect(idx.get(cellKey(0, 0))).toBe(3);
  });

  it("rebuild replaces the whole map from persisted entries", () => {
    const idx = new CellCompositeIndex();
    idx.set(cellKey(0, 0), 1);
    idx.rebuild([
      [cellKey(1, 0), 5],
      [cellKey(2, 0), 2],
    ]);
    expect(idx.get(cellKey(0, 0))).toBeUndefined();
    expect(idx.get(cellKey(1, 0))).toBe(5);
    expect(idx.get(cellKey(2, 0))).toBe(2);
  });

  it("clear empties the map", () => {
    const idx = new CellCompositeIndex();
    idx.set(cellKey(0, 0), 1);
    idx.clear();
    expect(idx.get(cellKey(0, 0))).toBeUndefined();
  });
});
