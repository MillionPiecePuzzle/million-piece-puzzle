import { describe, it, expect } from "vitest";
import { CELL_MASK_TIER_FACTORS } from "@mpp/shared";
import {
  badgeSquareLevel,
  dziTileImages,
  maskTierForZoom,
  pickBaseLevel,
  type DziInfo,
} from "./dziTiles";

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

describe("badgeSquareLevel", () => {
  // The prod board: 1000x1000 pieces of 120 source pixels, so the default badge
  // square (12 pieces) is 1440 world units a side.
  const prod = dziInfo(120000, 120000, 254);
  const square = 1440;

  // Level pixels the square spans: what the badge is actually drawn from.
  const spanAt = (info: DziInfo, worldSize: number, displayPx: number): number =>
    worldSize / 2 ** (info.maxLevel - badgeSquareLevel(info, worldSize, displayPx));

  it("cuts a row badge from the level that matches its own 40px, and no finer", () => {
    expect(spanAt(prod, square, 40)).toBeGreaterThanOrEqual(40);
    expect(spanAt(prod, square, 40)).toBeLessThan(80);
  });

  it("goes finer for the preview under the pointer, up to the tile it stays inside", () => {
    expect(badgeSquareLevel(prod, square, 192)).toBeGreaterThan(badgeSquareLevel(prod, square, 40));
    expect(spanAt(prod, square, 192)).toBeGreaterThan(prod.tileSize / 2);
  });

  it("keeps the square inside one tile, so a badge is one to four of them", () => {
    for (const px of [40, 192, 384, 4000]) {
      for (const pieces of [4, 12, 24]) {
        expect(spanAt(prod, pieces * 120, px), `${pieces} pieces at ${px}px`).toBeLessThanOrEqual(
          prod.tileSize,
        );
      }
    }
  });

  it("never leaves the pyramid's own level range", () => {
    const info = dziInfo(3000, 2000, 254);
    for (const worldSize of [1, 1e9]) {
      const level = badgeSquareLevel(info, worldSize, 40);
      expect(level, String(worldSize)).toBeGreaterThanOrEqual(0);
      expect(level, String(worldSize)).toBeLessThanOrEqual(info.maxLevel);
    }
  });
});

describe("dziTileImages", () => {
  const info = dziInfo(120000, 120000, 254);

  it("names the one tile a square inside it falls in", () => {
    const level = badgeSquareLevel(info, 1440, 40);
    const tiles = dziTileImages(
      info,
      level,
      { minX: 60000, minY: 30000, maxX: 61440, maxY: 31440 },
      "source_files/",
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.url).toBe(`source_files/${level}/7_3.webp`);
  });

  it("gives a tile the world rect its image really spans, overlap included", () => {
    const level = info.maxLevel;
    const [first, second] = dziTileImages(
      info,
      level,
      { minX: 250, minY: 0, maxX: 260, maxY: 1 },
      "source_files/",
    );
    // The first tile of a row starts at the picture's edge and reaches one pixel
    // into its neighbour; the next starts one pixel back, so the two overlap
    // instead of meeting, and a badge laid out from them has no seam.
    expect(first!.worldRect).toMatchObject({ minX: 0, maxX: 255 });
    expect(second!.worldRect).toMatchObject({ minX: 253, maxX: 509 });
  });

  it("answers with nothing for a square that is off the picture altogether", () => {
    const level = badgeSquareLevel(info, 1440, 40);
    const rect = { minX: -10000, minY: -10000, maxX: -8560, maxY: -8560 };
    expect(dziTileImages(info, level, rect, "source_files/")).toEqual([]);
  });
});
