import { describe, it, expect } from "vitest";
import { candidateGridIdsForCell, LockedPieceIndex } from "./lockedPieces.js";
import { cellKey } from "./worldGrid.js";

describe("candidateGridIdsForCell", () => {
  it("enumerates the exact (col, row) rectangle when the cell size divides evenly", () => {
    // cellSize 200, pieceSize 100: each cell holds a clean 2x2 block of pieces.
    const ids = candidateGridIdsForCell(1, 0, 200, 10, 10, 100);
    // cx=1 owns cols 2-3; cy=0 owns rows 0-1.
    expect(ids.sort((a, b) => a - b)).toEqual([2, 3, 12, 13]);
  });

  it("splits ownership at a boundary that does not fall on a piece edge, with no overlap and no gap", () => {
    // cellSize 325, pieceSize 32: col 10 straddles the boundary (spans world
    // [320, 352)), so it must belong to exactly one of cx=0 / cx=1, not both.
    const gridCols = 25;
    const gridRows = 1;
    const cell0 = candidateGridIdsForCell(0, 0, 325, gridCols, gridRows, 32);
    const cell1 = candidateGridIdsForCell(1, 0, 325, gridCols, gridRows, 32);
    expect(cell0).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cell1).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    // Every column appears in exactly one of the two adjacent cells.
    const overlap = cell0.filter((id) => cell1.includes(id));
    expect(overlap).toEqual([]);
  });

  it("clips to the grid bounds at the far edge", () => {
    // gridCols 25 (valid cols 0-24): cx=2 would otherwise own cols 21-30.
    const ids = candidateGridIdsForCell(2, 0, 325, 25, 1, 32);
    expect(ids).toEqual([21, 22, 23, 24]);
  });

  it("returns nothing for a cell entirely outside the grid", () => {
    expect(candidateGridIdsForCell(10, 0, 325, 25, 25, 32)).toEqual([]);
  });
});

describe("LockedPieceIndex", () => {
  const GRID_COLS = 25;
  const GRID_ROWS = 25;
  const PIECE_SIZE = 32;
  const CELL_SIZE = 325;
  const TOTAL = GRID_COLS * GRID_ROWS;

  it("reports isLocked only for pieces explicitly locked", () => {
    const idx = new LockedPieceIndex(GRID_COLS, GRID_ROWS, PIECE_SIZE, CELL_SIZE, TOTAL);
    idx.lock([5, 7]);
    expect(idx.isLocked(5)).toBe(true);
    expect(idx.isLocked(7)).toBe(true);
    expect(idx.isLocked(6)).toBe(false);
  });

  it("collect returns only locked ids among a cell's candidates", () => {
    const idx = new LockedPieceIndex(GRID_COLS, GRID_ROWS, PIECE_SIZE, CELL_SIZE, TOTAL);
    // Piece 10 is the last column cell (0,0) owns; piece 11 is the first cell (1,0) owns.
    idx.lock([10, 11]);
    const cell0 = cellKey(0, 0);
    const cell1 = cellKey(1, 0);
    expect(idx.collect([cell0])).toEqual([10]);
    expect(idx.collect([cell1])).toEqual([11]);
    expect(idx.collect([cell0, cell1]).sort((a, b) => a - b)).toEqual([10, 11]);
  });

  it("collect returns nothing for a cell with no locked piece", () => {
    const idx = new LockedPieceIndex(GRID_COLS, GRID_ROWS, PIECE_SIZE, CELL_SIZE, TOTAL);
    expect(idx.collect([cellKey(0, 0)])).toEqual([]);
  });

  it("rebuild replaces the whole bitset from a fresh piece read", () => {
    const idx = new LockedPieceIndex(GRID_COLS, GRID_ROWS, PIECE_SIZE, CELL_SIZE, TOTAL);
    idx.lock([1, 2, 3]);
    idx.rebuild([
      { id: 1, locked: false },
      { id: 4, locked: true },
    ]);
    expect(idx.isLocked(1)).toBe(false);
    expect(idx.isLocked(2)).toBe(false);
    expect(idx.isLocked(3)).toBe(false);
    expect(idx.isLocked(4)).toBe(true);
  });
});
