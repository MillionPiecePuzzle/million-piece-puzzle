import { describe, it, expect } from "vitest";
import { neededCellAssets } from "./dziRevealLayer";
import { LOD_TILE_WORLD } from "./groupGrid";
import type { Aabb } from "./cull";

const box = (minX: number, minY: number, maxX: number, maxY: number): Aabb => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("neededCellAssets", () => {
  it("returns the single cell covering a box within it", () => {
    const b = box(0, 0, LOD_TILE_WORLD - 1, LOD_TILE_WORLD - 1);
    expect(neededCellAssets(b)).toEqual([{ cx: 0, cy: 0 }]);
  });

  it("covers every cell a box spans, not just its origin cell", () => {
    const b = box(0, 0, LOD_TILE_WORLD * 2 - 1, LOD_TILE_WORLD - 1);
    const out = neededCellAssets(b);
    expect(out.sort((a, b2) => a.cx - b2.cx)).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
  });

  it("spans both axes when the box crosses a cell boundary on each", () => {
    const b = box(LOD_TILE_WORLD - 1, LOD_TILE_WORLD - 1, LOD_TILE_WORLD + 1, LOD_TILE_WORLD + 1);
    const out = neededCellAssets(b);
    const sortByCoord = (a: { cx: number; cy: number }, c: { cx: number; cy: number }): number =>
      a.cx - c.cx || a.cy - c.cy;
    expect(out.sort(sortByCoord)).toEqual(
      [
        { cx: 0, cy: 0 },
        { cx: 1, cy: 0 },
        { cx: 0, cy: 1 },
        { cx: 1, cy: 1 },
      ].sort(sortByCoord),
    );
  });
});
