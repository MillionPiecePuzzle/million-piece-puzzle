import { describe, it, expect } from "vitest";
import { boundsVisible, pieceLocalBounds, unionBounds, type Aabb, type Viewport } from "./cull";

const view: Viewport = { worldX: 0, worldY: 0, worldW: 100, worldH: 100 };

describe("pieceLocalBounds", () => {
  it("expands the piece cell by one margin on every side", () => {
    expect(pieceLocalBounds(10, 20, 80, 5)).toEqual({
      minX: 5,
      minY: 15,
      maxX: 95,
      maxY: 105,
    });
  });
});

describe("unionBounds", () => {
  it("returns a zero box for no inputs", () => {
    expect(unionBounds([])).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it("encloses every input box", () => {
    const boxes: Aabb[] = [
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: -5, minY: 3, maxX: 4, maxY: 20 },
    ];
    expect(unionBounds(boxes)).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 20 });
  });
});

describe("boundsVisible", () => {
  const box: Aabb = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it("is visible when fully inside the viewport", () => {
    expect(boundsVisible(box, 40, 40, view)).toBe(true);
  });

  it("is hidden when fully past the right edge", () => {
    expect(boundsVisible(box, 200, 40, view)).toBe(false);
  });

  it("is hidden when fully past the top edge", () => {
    expect(boundsVisible(box, 40, -200, view)).toBe(false);
  });

  it("counts edge contact as visible", () => {
    // The box right edge lands exactly on the viewport left edge.
    expect(boundsVisible(box, -10, 40, view)).toBe(true);
  });

  it("is hidden one unit past edge contact", () => {
    expect(boundsVisible(box, -11, 40, view)).toBe(false);
  });

  it("is visible when straddling a viewport corner", () => {
    expect(boundsVisible(box, -5, -5, view)).toBe(true);
  });
});
