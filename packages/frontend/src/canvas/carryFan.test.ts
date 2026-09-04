import { describe, it, expect } from "vitest";
import { fanAxis, fanColumns, fanDirection, fanSlot, type FanCell } from "./carryFan";

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

// The axis rule reads two rooms and cannot tell which side it is answering for,
// so the pairing is what these hold: a fan near an edge has to grow away from it.
describe("fanDirection", () => {
  const SCREEN = { width: 1600, height: 900 };
  const REACH = { width: 570, height: 426 };

  it("grows up and to the right from the middle of the screen", () => {
    expect(fanDirection(REACH, { x: 800, y: 450 }, SCREEN)).toEqual({ x: 1, y: 1 });
  });

  it("turns away from whichever edge the cursor is against", () => {
    expect(fanDirection(REACH, { x: 1570, y: 450 }, SCREEN).x).toBe(-1);
    expect(fanDirection(REACH, { x: 30, y: 450 }, SCREEN).x).toBe(1);
    expect(fanDirection(REACH, { x: 800, y: 30 }, SCREEN).y).toBe(-1);
    expect(fanDirection(REACH, { x: 800, y: 870 }, SCREEN).y).toBe(1);
  });

  it("keeps the whole fan on screen from every corner", () => {
    for (const cursor of [
      { x: 30, y: 30 },
      { x: 1570, y: 30 },
      { x: 30, y: 870 },
      { x: 1570, y: 870 },
    ]) {
      const towards = fanDirection(REACH, cursor, SCREEN);
      const left = towards.x > 0 ? cursor.x : cursor.x - REACH.width;
      const top = towards.y > 0 ? cursor.y - REACH.height : cursor.y;
      expect(left, JSON.stringify(cursor)).toBeGreaterThanOrEqual(0);
      expect(left + REACH.width, JSON.stringify(cursor)).toBeLessThanOrEqual(SCREEN.width);
      expect(top, JSON.stringify(cursor)).toBeGreaterThanOrEqual(0);
      expect(top + REACH.height, JSON.stringify(cursor)).toBeLessThanOrEqual(SCREEN.height);
    }
  });

  it("shows the most it can of a hand bigger than the screen", () => {
    const huge = { width: 4000, height: 4000 };
    expect(fanDirection(huge, { x: 1200, y: 700 }, SCREEN)).toEqual({ x: -1, y: 1 });
    expect(fanDirection(huge, { x: 400, y: 200 }, SCREEN)).toEqual({ x: 1, y: -1 });
  });
});
