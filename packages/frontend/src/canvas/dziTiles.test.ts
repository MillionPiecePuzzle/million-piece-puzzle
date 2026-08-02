import { describe, it, expect } from "vitest";
import { CELL_MASK_TIER_FACTORS } from "@mpp/shared";
import { maskTierForZoom, pickBaseLevel, type DziInfo } from "./dziTiles";

// MIN_ZOOM in puzzleStage.ts; kept as a literal here rather than imported so
// this test fails loudly if that floor ever moves without this file noticing.
const MIN_ZOOM = 0.15;

describe("maskTierForZoom", () => {
  it("picks the coarsest tier at the real MIN_ZOOM floor", () => {
    expect(maskTierForZoom(MIN_ZOOM)).toBe(CELL_MASK_TIER_FACTORS.length - 1);
  });

  it("stays on the coarsest tier through the whole low-zoom overview band", () => {
    expect(maskTierForZoom(0.2)).toBe(2);
    expect(maskTierForZoom(0.29)).toBe(2);
    // 0.25 was the previous formula's tier0/tier1 crossover; it must no
    // longer land on native resolution.
    expect(maskTierForZoom(0.25)).toBe(2);
  });

  it("picks the middle tier through the mid-zoom band", () => {
    expect(maskTierForZoom(0.3)).toBe(1);
    expect(maskTierForZoom(0.6)).toBe(1);
    expect(maskTierForZoom(0.99)).toBe(1);
  });

  it("only reaches native resolution once zoomed in close enough for the ring to shrink", () => {
    expect(maskTierForZoom(1.0)).toBe(0);
    expect(maskTierForZoom(2.0)).toBe(0);
  });
});

const dziInfo = (width: number, height: number, tileSize: number): DziInfo => ({
  tileSize,
  overlap: 1,
  format: "webp",
  width,
  height,
  maxLevel: Math.ceil(Math.log2(Math.max(width, height))),
});

describe("pickBaseLevel", () => {
  it("covers the real synthetic-1m image in a small, bounded tile grid", () => {
    const info = dziInfo(72000, 72000, 254);
    const level = pickBaseLevel(info, 64);
    const cols = Math.ceil(Math.ceil(72000 / 2 ** (info.maxLevel - level)) / 254);
    expect(cols * cols).toBeLessThanOrEqual(64);
    // One level finer must already exceed the cap, otherwise a higher-detail
    // level was left on the table for no reason.
    const colsNext = Math.ceil(Math.ceil(72000 / 2 ** (info.maxLevel - (level + 1))) / 254);
    expect(colsNext * colsNext).toBeGreaterThan(64);
  });

  it("never picks past maxLevel for an image smaller than one tile", () => {
    const info = dziInfo(100, 100, 254);
    expect(pickBaseLevel(info, 64)).toBe(info.maxLevel);
  });
});
