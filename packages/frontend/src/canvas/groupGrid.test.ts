import { describe, it, expect } from "vitest";
import { GroupGrid, cellKeysForRect, packCell, unpackCell } from "./groupGrid";
import type { Aabb } from "./cull";

const box = (minX: number, minY: number, maxX: number, maxY: number): Aabb => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("packCell / unpackCell", () => {
  it("round-trips signed cell coordinates", () => {
    const cases: [number, number][] = [
      [0, 0],
      [3, -7],
      [-1, -1],
      [1234, -5678],
    ];
    for (const [cx, cy] of cases) {
      expect(unpackCell(packCell(cx, cy))).toEqual({ cx, cy });
    }
  });

  it("is collision-free across distinct cells", () => {
    const keys = new Set<number>();
    for (let cx = -3; cx <= 3; cx++) for (let cy = -3; cy <= 3; cy++) keys.add(packCell(cx, cy));
    expect(keys.size).toBe(49);
  });
});

describe("cellKeysForRect", () => {
  it("returns the single cell a box fully inside one cell touches", () => {
    expect(cellKeysForRect(box(10, 10, 90, 90), 100)).toEqual([packCell(0, 0)]);
  });

  it("spans every cell a box straddles", () => {
    const keys = cellKeysForRect(box(90, 90, 210, 110), 100);
    expect(new Set(keys)).toEqual(
      new Set([
        packCell(0, 0),
        packCell(1, 0),
        packCell(2, 0),
        packCell(0, 1),
        packCell(1, 1),
        packCell(2, 1),
      ]),
    );
  });

  it("handles negative coordinates", () => {
    expect(cellKeysForRect(box(-10, -10, -5, -5), 100)).toEqual([packCell(-1, -1)]);
  });
});

describe("GroupGrid", () => {
  it("indexes a group into the cells its AABB spans", () => {
    const grid = new GroupGrid(100);
    grid.upsert(1, box(10, 10, 90, 90));
    expect([...grid.cellsOf(1)]).toEqual([packCell(0, 0)]);
    expect(grid.cellGroups(packCell(0, 0))).toEqual(new Set([1]));
  });

  it("queries every group overlapping a rect", () => {
    const grid = new GroupGrid(100);
    grid.upsert(1, box(10, 10, 50, 50));
    grid.upsert(2, box(120, 20, 180, 60));
    grid.upsert(3, box(20, 220, 60, 260));
    expect(grid.queryRect(box(0, 0, 90, 90))).toEqual(new Set([1]));
    expect(grid.queryRect(box(0, 0, 190, 90))).toEqual(new Set([1, 2]));
    expect(grid.queryRect(box(0, 0, 290, 290))).toEqual(new Set([1, 2, 3]));
  });

  it("moves a group between cells on upsert, leaving no stale membership", () => {
    const grid = new GroupGrid(100);
    grid.upsert(1, box(10, 10, 50, 50));
    grid.upsert(1, box(310, 310, 350, 350));
    expect(grid.cellGroups(packCell(0, 0))).toBeUndefined();
    expect(grid.cellGroups(packCell(3, 3))).toEqual(new Set([1]));
    expect([...grid.cellsOf(1)]).toEqual([packCell(3, 3)]);
  });

  it("is a no-op when the cell set is unchanged", () => {
    const grid = new GroupGrid(100);
    grid.upsert(1, box(10, 10, 50, 50));
    grid.upsert(1, box(20, 20, 60, 60));
    expect(grid.cellGroups(packCell(0, 0))).toEqual(new Set([1]));
  });

  it("removes a group from every cell and its reverse index", () => {
    const grid = new GroupGrid(100);
    grid.upsert(1, box(90, 90, 210, 110));
    grid.remove(1);
    expect(grid.cellsOf(1)).toEqual([]);
    expect(grid.cellGroups(packCell(0, 0))).toBeUndefined();
    expect(grid.cellGroups(packCell(2, 1))).toBeUndefined();
    expect(grid.queryRect(box(0, 0, 300, 300))).toEqual(new Set());
  });

  it("keeps other groups in a shared cell when one is removed", () => {
    const grid = new GroupGrid(100);
    grid.upsert(1, box(10, 10, 50, 50));
    grid.upsert(2, box(20, 20, 60, 60));
    grid.remove(1);
    expect(grid.cellGroups(packCell(0, 0))).toEqual(new Set([2]));
  });

  it("clear empties the index", () => {
    const grid = new GroupGrid(100);
    grid.upsert(1, box(10, 10, 50, 50));
    grid.clear();
    expect(grid.queryRect(box(0, 0, 300, 300))).toEqual(new Set());
    expect(grid.cellsOf(1)).toEqual([]);
  });
});
