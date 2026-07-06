import { describe, it, expect } from "vitest";
import { batchEnteredCells } from "./regionStream.js";
import { cellKey } from "./worldGrid.js";

const CELL = 100;

describe("batchEnteredCells", () => {
  it("returns one batch covering exactly the entered cells when they fit the budget", () => {
    const entered = [cellKey(0, 0), cellKey(1, 0), cellKey(0, 1)];
    const batches = batchEnteredCells(entered, CELL, 16);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.cells.slice().sort((a, b) => a - b)).toEqual(
      entered.slice().sort((a, b) => a - b),
    );
    expect(batches[0]!.coverage).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 200 });
  });

  it("splits a wide, short entered region into disjoint column-range batches", () => {
    // 20 columns, one cell each: the minimap-jump shape when a viewport is much
    // wider than it is tall.
    const entered = Array.from({ length: 20 }, (_, cx) => cellKey(cx, 0));
    const batches = batchEnteredCells(entered, CELL, 16);
    expect(batches.map((b) => b.cells.length)).toEqual([16, 4]);
    expect(batches[0]!.coverage).toEqual({ minX: 0, minY: 0, maxX: 1600, maxY: 100 });
    expect(batches[1]!.coverage).toEqual({ minX: 1600, minY: 0, maxX: 2000, maxY: 100 });
  });

  it("slices a single column that alone exceeds the batch budget into solo sub-batches", () => {
    // One column, 50 cells tall: a narrow, very tall viewport.
    const entered = Array.from({ length: 50 }, (_, cy) => cellKey(0, cy));
    const batches = batchEnteredCells(entered, CELL, 16);
    expect(batches.map((b) => b.cells.length)).toEqual([16, 16, 16, 2]);
    expect(batches[0]!.coverage).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 1600 });
    expect(batches[1]!.coverage).toEqual({ minX: 0, minY: 1600, maxX: 100, maxY: 3200 });
    expect(batches[2]!.coverage).toEqual({ minX: 0, minY: 3200, maxX: 100, maxY: 4800 });
    expect(batches[3]!.coverage).toEqual({ minX: 0, minY: 4800, maxX: 100, maxY: 5000 });
  });

  it("never merges an oversized column with a neighbouring column's cells", () => {
    const entered = [
      ...Array.from({ length: 5 }, (_, cy) => cellKey(0, cy)),
      ...Array.from({ length: 50 }, (_, cy) => cellKey(1, cy)), // oversized
      ...Array.from({ length: 5 }, (_, cy) => cellKey(2, cy)),
    ];
    const batches = batchEnteredCells(entered, CELL, 16);
    expect(batches.map((b) => b.cells.length)).toEqual([5, 16, 16, 16, 2, 5]);
    // Every batch's coverage spans exactly one column: column 0's and column
    // 2's batches never widen to include column 1's oversized cells.
    for (const b of batches) expect(b.coverage.maxX - b.coverage.minX).toBe(CELL);
    expect(batches[0]!.coverage.minX).toBe(0);
    expect(batches[1]!.coverage.minX).toBe(CELL);
    expect(batches[4]!.coverage.minX).toBe(CELL);
    expect(batches[5]!.coverage.minX).toBe(2 * CELL);
  });

  it("partitions every entered cell exactly once across all batches, negative columns included", () => {
    const entered = [
      ...Array.from({ length: 5 }, (_, cy) => cellKey(-2, cy)),
      ...Array.from({ length: 30 }, (_, cy) => cellKey(3, cy - 10)),
      cellKey(7, 0),
    ];
    const batches = batchEnteredCells(entered, CELL, 8);
    const seen = batches.flatMap((b) => b.cells);
    expect(seen.slice().sort((a, b) => a - b)).toEqual(entered.slice().sort((a, b) => a - b));
    expect(new Set(seen).size).toBe(entered.length);
  });
});
