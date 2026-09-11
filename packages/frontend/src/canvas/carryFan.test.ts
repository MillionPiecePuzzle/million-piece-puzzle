import { describe, it, expect } from "vitest";
import {
  fanColumns,
  fanDirection,
  fanShift,
  fanSlot,
  type FanCell,
  type FanDirection,
  type FanRoom,
} from "./carryFan";

const CELL: FanCell = { width: 100, height: 80 };
const GAP = 20;

const VIEW = { width: 1280, height: 748 };
const UP_RIGHT: FanDirection = { x: 1, y: 1 };

// A cursor in the lower-left quarter of the view, where the hand has room ahead
// of it on both axes and next to none behind.
const LOWER_LEFT: FanRoom = { left: 250, right: 1030, up: 600, down: 148 };

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

  it("grows up and to the right while the hand fits there", () => {
    expect(fanDirection(490, 420, LOWER_LEFT)).toEqual({ x: 1, y: 1 });
    // Exactly the room it has still fits in it.
    expect(fanDirection(1030, 600, LOWER_LEFT)).toEqual({ x: 1, y: 1 });
  });

  it("turns back when the room ahead is too short and the room behind is not", () => {
    const upperRight: FanRoom = { left: 1030, right: 250, up: 148, down: 600 };
    expect(fanDirection(490, 420, upperRight)).toEqual({ x: -1, y: -1 });
  });

  it("takes the roomier side when a hand fits on neither", () => {
    const middle: FanRoom = { left: 400, right: 880, up: 300, down: 448 };
    expect(fanDirection(2000, 900, middle)).toEqual({ x: 1, y: -1 });
  });

  it("leaves a hand that already sits inside the view where it is", () => {
    const shift = fanShift({ x: 250, y: 600 }, { x: 490, y: 420 }, UP_RIGHT, VIEW);
    expect(shift).toEqual({ x: 0, y: 0 });
  });

  it("slides a hand back in when the cursor stands too close to an edge for it", () => {
    // Reaching 420px up from y = 374 hangs 46px past the top of the view.
    expect(fanShift({ x: 250, y: 374 }, { x: 490, y: 420 }, UP_RIGHT, VIEW).y).toBe(46);
    // And 490px right of x = 1000 hangs 210px past its right edge.
    expect(fanShift({ x: 1000, y: 600 }, { x: 490, y: 420 }, UP_RIGHT, VIEW).x).toBe(-210);
  });

  it("slides a hand growing the other way back off the edges it runs at", () => {
    const downLeft: FanDirection = { x: -1, y: -1 };
    expect(fanShift({ x: 200, y: 600 }, { x: 490, y: 420 }, downLeft, VIEW)).toEqual({
      x: 290,
      y: -272,
    });
  });

  it("leaves an axis the hand is longer than the view alone", () => {
    const shift = fanShift({ x: 640, y: 374 }, { x: 2000, y: 900 }, UP_RIGHT, VIEW);
    expect(shift).toEqual({ x: 0, y: 0 });
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
