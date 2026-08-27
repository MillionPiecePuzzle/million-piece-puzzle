import { describe, it, expect } from "vitest";
import { GroupIndex, type GroupPayload } from "./groupIndex.js";
import { cellKey } from "./worldGrid.js";

const CELL = 100;
const PIECE = 20;
// Cell key for the cell containing a world point, the way the index keys groups.
const keyAt = (x: number, y: number): number => cellKey(Math.floor(x / CELL), Math.floor(y / CELL));

// Default payload helper: a singleton whose origin equals its body min.
const at = (x: number, y: number): GroupPayload => ({
  originX: x,
  originY: y,
  size: 1,
  width: PIECE,
  height: PIECE,
});

describe("GroupIndex", () => {
  it("keys by the body min and reports the origin payload on collect", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350, at(250, 350));
    expect(idx.cellOf(7)).toBe(keyAt(250, 350));
    expect(idx.collect([keyAt(250, 350)])).toEqual([
      { groupId: 7, worldX: 250, worldY: 350, size: 1 },
    ]);
  });

  it("keys by the body min but reports the (different) origin", () => {
    const idx = new GroupIndex(CELL);
    // Body min sits in cell (2,3); the origin a canonical offset away in cell (0,0).
    idx.set(7, 250, 350, { originX: 50, originY: 50, size: 4, width: 40, height: 40 });
    expect(idx.cellOf(7)).toBe(keyAt(250, 350));
    // The origin's cell holds nothing; collect reports the origin from the body cell.
    expect(idx.collect([keyAt(50, 50)])).toEqual([]);
    expect(idx.collect([keyAt(250, 350)])).toEqual([
      { groupId: 7, worldX: 50, worldY: 50, size: 4 },
    ]);
  });

  it("does not return a group from a cell it is not in", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350, at(250, 350));
    expect(idx.collect([keyAt(0, 0)])).toEqual([]);
  });

  it("moves a group between cells, leaving the old cell empty", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350, at(250, 350));
    const oldKey = keyAt(250, 350);
    idx.set(7, 1050, 1050, at(1050, 1050));
    expect(idx.cellOf(7)).toBe(keyAt(1050, 1050));
    expect(idx.collect([oldKey])).toEqual([]);
    expect(idx.collect([keyAt(1050, 1050)])).toEqual([
      { groupId: 7, worldX: 1050, worldY: 1050, size: 1 },
    ]);
  });

  it("refreshes the stored payload without churning the cell when it stays in cell", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350, at(250, 350));
    const cell = idx.cellOf(7);
    // same cell, new payload
    idx.set(7, 299, 399, { originX: 299, originY: 399, size: 2, width: 40, height: 20 });
    expect(idx.cellOf(7)).toBe(cell);
    expect(idx.collect([cell!])).toEqual([{ groupId: 7, worldX: 299, worldY: 399, size: 2 }]);
  });

  it("removes a group from its cell and the index", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350, at(250, 350));
    idx.remove(7);
    expect(idx.cellOf(7)).toBeUndefined();
    expect(idx.collect([keyAt(250, 350)])).toEqual([]);
    expect(idx.size).toBe(0);
  });

  it("collects every group across the requested cells, one entry per group", () => {
    const idx = new GroupIndex(CELL);
    idx.set(1, 10, 10, at(10, 10)); // cell (0,0)
    idx.set(2, 20, 20, at(20, 20)); // cell (0,0)
    idx.set(3, 150, 10, at(150, 10)); // cell (1,0)
    const got = idx.collect([keyAt(10, 10), keyAt(150, 10)]);
    expect(got.map((g) => g.groupId).sort()).toEqual([1, 2, 3]);
  });

  it("reports a group standing in the queried box", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350, at(250, 350));
    expect(idx.overlapsBox({ minX: 260, minY: 360, maxX: 280, maxY: 380 }, 0)).toBe(true);
    expect(idx.overlapsBox({ minX: 260, minY: 360, maxX: 280, maxY: 380 }, 7)).toBe(false);
  });

  it("reads edge contact as clear", () => {
    const idx = new GroupIndex(CELL);
    idx.set(7, 250, 350, at(250, 350));
    expect(idx.overlapsBox({ minX: 265, minY: 350, maxX: 285, maxY: 370 }, 0)).toBe(true);
    // The box starts exactly where the group's body ends (250 + PIECE).
    expect(idx.overlapsBox({ minX: 270, minY: 350, maxX: 290, maxY: 370 }, 0)).toBe(false);
  });

  it("catches a cluster reaching into the box from cells above and left of it", () => {
    const idx = new GroupIndex(CELL);
    // Body min in cell (0,0), body running three cells across and down: the box
    // sits in cell (3,3), where the index holds no entry at all.
    idx.set(7, 50, 50, { originX: 50, originY: 50, size: 900, width: 300, height: 300 });
    expect(idx.overlapsBox({ minX: 320, minY: 320, maxX: 340, maxY: 340 }, 0)).toBe(true);
    expect(idx.overlapsBox({ minX: 360, minY: 360, maxX: 380, maxY: 380 }, 0)).toBe(false);
  });

  it("clear empties the index", () => {
    const idx = new GroupIndex(CELL);
    idx.set(1, 10, 10, at(10, 10));
    idx.set(2, 500, 500, at(500, 500));
    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.collect([keyAt(10, 10), keyAt(500, 500)])).toEqual([]);
  });
});
