import { describe, it, expect } from "vitest";
import { fanAxis, fanColumns, fanSlot, type FanCell } from "./carryFan";

const CELL: FanCell = { width: 100, height: 80 };
const GAP = 20;

describe("carry fan", () => {
  it("keeps the grid as square as the count allows", () => {
    expect(fanColumns(1)).toBe(1);
    expect(fanColumns(2)).toBe(2);
    expect(fanColumns(4)).toBe(2);
    expect(fanColumns(5)).toBe(3);
    expect(fanColumns(9)).toBe(3);
    expect(fanColumns(10)).toBe(4);
  });

  it("puts the first cluster on the corner itself", () => {
    expect(fanSlot(0, fanColumns(10), CELL, GAP)).toEqual({ dx: 0, dy: 0 });
  });

  it("fills left to right, then upward", () => {
    const columns = fanColumns(10);
    expect(fanSlot(1, columns, CELL, GAP)).toEqual({ dx: 120, dy: 0 });
    expect(fanSlot(3, columns, CELL, GAP)).toEqual({ dx: 360, dy: 0 });
    expect(fanSlot(4, columns, CELL, GAP)).toEqual({ dx: 0, dy: 100 });
    expect(fanSlot(9, columns, CELL, GAP)).toEqual({ dx: 120, dy: 200 });
  });

  it("keeps its preferred side while the fan fits there", () => {
    expect(fanAxis(500, 200, 300)).toBe(1);
    expect(fanAxis(300, 300, 300)).toBe(1);
  });

  it("takes the other side when only that one fits", () => {
    expect(fanAxis(200, 500, 300)).toBe(-1);
  });

  it("takes the roomier side when a hand fits on neither", () => {
    expect(fanAxis(200, 400, 900)).toBe(-1);
    expect(fanAxis(400, 200, 900)).toBe(1);
  });

  it("leaves no two clusters overlapping, whatever the count", () => {
    for (let count = 1; count <= 10; count++) {
      const columns = fanColumns(count);
      const boxes = Array.from({ length: count }, (_, i) => fanSlot(i, columns, CELL, GAP));
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          const x = boxes[a]!,
            y = boxes[b]!;
          const apart =
            Math.abs(x.dx - y.dx) >= CELL.width + GAP || Math.abs(x.dy - y.dy) >= CELL.height + GAP;
          expect(apart).toBe(true);
        }
      }
    }
  });
});
