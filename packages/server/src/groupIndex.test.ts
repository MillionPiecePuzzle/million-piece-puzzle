import { describe, it, expect } from "vitest";
import { GroupIndex } from "./groupIndex.js";
import { cellKey } from "./worldGrid.js";

const CELL = 100;
// Cell key for the cell containing a world point, the way the index keys groups.
const keyAt = (x: number, y: number): number => cellKey(Math.floor(x / CELL), Math.floor(y / CELL));

describe("GroupIndex", () => {
  it("places a group in the cell of its world point and returns it on collect", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350);
    expect(idx.cellOf(7)).toBe(keyAt(250, 350));
    expect(idx.collect([keyAt(250, 350)])).toEqual([{ groupId: 7, worldX: 250, worldY: 350 }]);
  });

  it("does not return a group from a cell it is not in", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350);
    expect(idx.collect([keyAt(0, 0)])).toEqual([]);
  });

  it("moves a group between cells, leaving the old cell empty", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350);
    const oldKey = keyAt(250, 350);
    idx.set(7, 1050, 1050);
    expect(idx.cellOf(7)).toBe(keyAt(1050, 1050));
    expect(idx.collect([oldKey])).toEqual([]);
    expect(idx.collect([keyAt(1050, 1050)])).toEqual([{ groupId: 7, worldX: 1050, worldY: 1050 }]);
  });

  it("refreshes the stored position without churning the cell when it stays in cell", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350);
    const cell = idx.cellOf(7);
    idx.set(7, 299, 399); // same cell, new position
    expect(idx.cellOf(7)).toBe(cell);
    expect(idx.collect([cell!])).toEqual([{ groupId: 7, worldX: 299, worldY: 399 }]);
  });

  it("removes a group from its cell and the index", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350);
    idx.remove(7);
    expect(idx.cellOf(7)).toBeUndefined();
    expect(idx.collect([keyAt(250, 350)])).toEqual([]);
    expect(idx.size).toBe(0);
  });

  it("collects every group across the requested cells, one entry per group", () => {
    const idx = new GroupIndex(CELL);
    idx.set(1, 10, 10); // cell (0,0)
    idx.set(2, 20, 20); // cell (0,0)
    idx.set(3, 150, 10); // cell (1,0)
    const got = idx.collect([keyAt(10, 10), keyAt(150, 10)]);
    expect(got.map((g) => g.groupId).sort()).toEqual([1, 2, 3]);
  });

  it("clear empties the index", () => {
    const idx = new GroupIndex(CELL);
    idx.set(1, 10, 10);
    idx.set(2, 500, 500);
    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.collect([keyAt(10, 10), keyAt(500, 500)])).toEqual([]);
  });
});
