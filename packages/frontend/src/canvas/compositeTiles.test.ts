import { describe, it, expect } from "vitest";
import { desiredLevel, neededCompositeTiles } from "./compositeTiles";
import { LOD_TILE_WORLD } from "./groupGrid";
import type { Aabb } from "./cull";

const box = (minX: number, minY: number, maxX: number, maxY: number): Aabb => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("desiredLevel", () => {
  it("picks level 0 at native zoom on the first call", () => {
    expect(desiredLevel(1, 1, 1, -1, 3)).toBe(0);
  });

  it("picks a higher level when zoomed out, proportional to log2 of the density ratio", () => {
    // nativeDensity 1, zoom 0.25 -> needed 0.25 -> raw = log2(1/0.25) = 2.
    expect(desiredLevel(0.25, 1, 1, -1, 3)).toBe(2);
  });

  it("clamps to maxLevel rather than selecting a level the server never builds", () => {
    // Deep enough zoom-out that the raw level would exceed 3.
    expect(desiredLevel(0.01, 1, 1, -1, 3)).toBe(3);
  });

  it("clamps to 0 rather than going negative when zoomed in past native", () => {
    expect(desiredLevel(5, 1, 1, -1, 3)).toBe(0);
  });

  it("folds dpr into the required density the same way zoom does", () => {
    // zoom 0.5 at dpr 2 needs the same density as zoom 1 at dpr 1 (both 1
    // texel/world-unit needed), so both should resolve to level 0.
    expect(desiredLevel(1, 1, 1, -1, 3)).toBe(desiredLevel(0.5, 2, 1, -1, 3));
  });

  it("stays at the previous level within the hysteresis band instead of thrashing", () => {
    // nativeDensity 1, zoom 0.7 -> raw = log2(1/0.7) ~= 0.515, within 0.65 of
    // previousLevel 0 (the 0.5 level-boundary plus the 0.15 hysteresis
    // margin), so it should not switch to 1 yet.
    expect(desiredLevel(0.7, 1, 1, 0, 3)).toBe(0);
  });

  it("switches once the raw value moves far enough past the hysteresis margin", () => {
    // raw = 1 is comfortably past level 0's hysteresis band (0.5 + 0.15).
    expect(desiredLevel(0.5, 1, 1, 0, 3)).toBe(1);
  });
});

describe("neededCompositeTiles", () => {
  const allHydrated = () => true;
  const noneHydrated = () => false;

  it("returns exactly the desired-level cells covering the box when everything is hydrated", () => {
    const b = box(0, 0, LOD_TILE_WORLD - 1, LOD_TILE_WORLD - 1);
    const out = neededCompositeTiles(b, 2, allHydrated);
    expect(out).toEqual([{ level: 2, cx: 0, cy: 0 }]);
  });

  it("falls back to the 4 level-1 children when the desired level-2 cell is not hydrated", () => {
    const b = box(0, 0, LOD_TILE_WORLD - 1, LOD_TILE_WORLD - 1);
    const out = neededCompositeTiles(b, 2, noneHydrated);
    const level2 = out.filter((c) => c.level === 2);
    const level1 = out.filter((c) => c.level === 1);
    const level0 = out.filter((c) => c.level === 0);
    expect(level2).toEqual([{ level: 2, cx: 0, cy: 0 }]);
    // A level-2 cell spans a 2x2 block of level-1 cells.
    const sortByCoord = (a: { cx: number; cy: number }, b2: { cx: number; cy: number }): number =>
      a.cx - b2.cx || a.cy - b2.cy;
    expect(level1.sort(sortByCoord)).toEqual(
      [
        { level: 1, cx: 0, cy: 0 },
        { level: 1, cx: 1, cy: 0 },
        { level: 1, cx: 0, cy: 1 },
        { level: 1, cx: 1, cy: 1 },
      ].sort(sortByCoord),
    );
    // Since none of those are hydrated either, it bottoms out at level 0 too.
    expect(level0.length).toBe(16);
  });

  it("stops recursing at a level whose own tile is already hydrated", () => {
    const b = box(0, 0, LOD_TILE_WORLD - 1, LOD_TILE_WORLD - 1);
    const isHydrated = (level: number, cx: number, cy: number): boolean =>
      level === 1 && cx === 0 && cy === 0;
    const out = neededCompositeTiles(b, 2, isHydrated);
    // The level-2 cell isn't hydrated, so it recurses to its 4 level-1
    // children; (0,0) at level 1 IS hydrated, so it stops there, but the
    // other 3 children keep recursing down to level 0.
    expect(out.filter((c) => c.level === 1).length).toBe(4);
    expect(out.filter((c) => c.level === 0).length).toBe(12);
  });

  it("never recurses below level 0", () => {
    const b = box(0, 0, LOD_TILE_WORLD - 1, LOD_TILE_WORLD - 1);
    const out = neededCompositeTiles(b, 0, noneHydrated);
    expect(out).toEqual([{ level: 0, cx: 0, cy: 0 }]);
  });

  it("covers every cell a box spans at the desired level, not just its origin cell", () => {
    const b = box(0, 0, LOD_TILE_WORLD * 2 - 1, LOD_TILE_WORLD - 1);
    const out = neededCompositeTiles(b, 0, allHydrated);
    expect(out.sort((a, b2) => a.cx - b2.cx)).toEqual([
      { level: 0, cx: 0, cy: 0 },
      { level: 0, cx: 1, cy: 0 },
    ]);
  });
});
