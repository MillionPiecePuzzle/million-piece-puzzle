// Deep Zoom Image (DZI) tile math for the reference photo pyramid (see
// packages/shared/src/manifest.ts's doc comment and scripts/slice-image.ts's
// `sharp().tile({ layout: "dz", ... })`).

import { CELL_MASK_TIER_FACTORS } from "@mpp/shared";
import type { Aabb } from "./cull";

export type DziInfo = {
  tileSize: number;
  overlap: number;
  format: string;
  width: number;
  height: number;
  maxLevel: number;
};

// Attribute order is not guaranteed (libvips emits Format/Overlap/TileSize on
// <Image>, Height/Width on <Size>, both reversed from a naive reading order),
// so each attribute is matched independently rather than as one sequential
// pattern.
function xmlAttr(xml: string, name: string): string {
  const m = new RegExp(`\\b${name}="([^"]+)"`).exec(xml);
  if (!m) throw new Error(`dzi descriptor missing ${name} attribute`);
  return m[1]!;
}

export async function fetchDziInfo(dziUrl: string): Promise<DziInfo> {
  const res = await fetch(dziUrl);
  if (!res.ok) throw new Error(`dzi fetch ${dziUrl} returned HTTP ${res.status}`);
  const xml = await res.text();
  if (!/<Image[\s>]/.test(xml)) throw new Error(`could not parse dzi descriptor at ${dziUrl}`);
  const width = Number(xmlAttr(xml, "Width"));
  const height = Number(xmlAttr(xml, "Height"));
  return {
    tileSize: Number(xmlAttr(xml, "TileSize")),
    overlap: Number(xmlAttr(xml, "Overlap")),
    format: xmlAttr(xml, "Format"),
    width,
    height,
    maxLevel: Math.ceil(Math.log2(Math.max(width, height))),
  };
}

// The DZI level whose native pixel pitch (world units per native pixel, the
// pyramid maps 1:1 onto world units at maxLevel, see manifest.ts) most
// closely matches the current world-units-per-screen-pixel (1 / zoom, zoom
// being screen pixels per world unit, this codebase's own camera
// convention), so one native DZI pixel maps to roughly one screen pixel:
// sharper as the camera zooms in, coarser as it zooms out, same as any
// deep-zoom viewer. Clamped to the pyramid's real level range.
export function levelForZoom(info: DziInfo, zoom: number): number {
  const ideal = Math.round(info.maxLevel + Math.log2(zoom));
  return Math.min(info.maxLevel, Math.max(0, ideal));
}

export function levelDimension(nativeSize: number, info: DziInfo, level: number): number {
  return Math.ceil(nativeSize / 2 ** (info.maxLevel - level));
}

// The level a bookmark badge is drawn from. A badge is a square of the board of
// its own size, drawn at whatever size the page gives it, so the level follows
// that pairing rather than the board: the same square is cut from a coarse level
// for a 40px row and from a finer one for the 192px preview, each sharp where it
// is shown. `Math.ceil` rather than `levelForZoom`'s round, so a badge is a
// downscale of a sharper level and never an upscale of a softer one. Capped at
// the level where the square still spans at most one tile, which is what holds a
// badge to the one to four tiles it touches whatever size it is drawn at.
export function badgeSquareLevel(info: DziInfo, worldSize: number, displayPx: number): number {
  const ideal = Math.ceil(info.maxLevel + Math.log2(displayPx / worldSize));
  const oneTile = Math.floor(info.maxLevel + Math.log2(info.tileSize / worldSize));
  return Math.max(0, Math.min(ideal, oneTile, info.maxLevel));
}

// The per-cell mask/seam LOD tier (see cellCompositor.ts's bakeTiers, same
// CELL_MASK_TIER_FACTORS) to fetch for the current zoom, chosen to keep a
// full hydrate ring inside CELL_ASSET_VRAM_BUDGET_MB (see
// dziRevealLayer.ts), not to preserve "1 native pixel ~= 1 screen pixel"
// sharpness. An earlier version picked the coarsest tier whose downscale
// factor did not exceed 1/zoom: that keeps the mask exactly as sharp as the
// zoom warrants, but a hydrate ring's cell count scales with 1/zoom^2 (fixed
// margin fractions of a screen-sized viewport), so sharpness-preserving
// downscale grows far slower than the VRAM cost actually does. At
// MIN_ZOOM (0.15, puzzleStage.ts) that formula needs 1/0.15 =~ 6.7x
// downscale, so it never even reached CELL_MASK_TIER_FACTORS' own coarsest
// entry (16x) - dead code - and it stayed on tier 0 (native, ~33.6MB per
// cell decoded per DECISIONS) for any zoom above 0.25, i.e. almost the
// entire practical zoom range, reproducing the pre-tiering VRAM-thrashing
// bug it was built to fix.
//
// These breakpoints are chosen from the ring-cell-count math instead: at
// zoom Z the ring covers on the order of (0.15 / Z)^2 * 300 cells (300+
// cells measured at MIN_ZOOM=0.15, see DECISIONS). Each breakpoint is set so
// the *worst case at the low-zoom edge of its own band* still fits the
// 256MB budget: tier 2 (16x, ~0.13MB/cell) up to 0.3 zoom (~300 cells =~
// 39MB), tier 1 (4x, ~2.1MB/cell) up to 1.0 zoom (~75 cells at the 0.3 edge
// =~ 157MB), tier 0 (native) above that (~7 cells at the 1.0 edge =~
// 225MB). Estimates, not yet empirically tuned against real usage (see
// DECISIONS): retune if a real-scale pass still shows thrashing near a
// breakpoint.
const TIER_ZOOM_BREAKPOINTS = [0.3, 1.0];

export function maskTierForZoom(zoom: number): number {
  for (let i = 0; i < TIER_ZOOM_BREAKPOINTS.length; i++) {
    if (zoom < TIER_ZOOM_BREAKPOINTS[i]!) return CELL_MASK_TIER_FACTORS.length - 1 - i;
  }
  return 0;
}

// The highest-detail level whose tile grid still covers the WHOLE image in
// at most maxTiles tiles - i.e. the level a small, fixed-size deep-zoom
// viewport would land on for free (see this puzzle's own reference-image
// thumbnail, which looks instant purely because it is physically small
// enough that a handful of coarse tiles already covers it). The main canvas
// has no such natural ceiling (it can be the whole browser window), so
// DziRevealLayer picks this level explicitly and keeps its tiles resident
// permanently as a base layer: something is visible everywhere from the
// very first frame, the same way any real deep-zoom or map viewer never
// shows a blank tile while a sharper one is still loading.
export function pickBaseLevel(info: DziInfo, maxTiles: number): number {
  let level = 0;
  for (let l = 0; l <= info.maxLevel; l++) {
    const cols = Math.ceil(levelDimension(info.width, info, l) / info.tileSize);
    const rows = Math.ceil(levelDimension(info.height, info, l) / info.tileSize);
    if (cols * rows > maxTiles) break;
    level = l;
  }
  return level;
}

// The tile grid of a level, and the block of it a world rect falls in. A rect
// entirely off the level answers with an empty block (col0 past col1), so a
// caller's loop runs zero times rather than over the whole grid.
function tileBlock(info: DziInfo, level: number, rect: Aabb) {
  const scale = 2 ** (info.maxLevel - level);
  const worldPerTile = info.tileSize * scale;
  const cols = Math.ceil(levelDimension(info.width, info, level) / info.tileSize);
  const rows = Math.ceil(levelDimension(info.height, info, level) / info.tileSize);
  return {
    scale,
    cols,
    rows,
    worldPerTile,
    col0: Math.max(0, Math.floor(rect.minX / worldPerTile)),
    col1: Math.min(cols - 1, Math.floor(rect.maxX / worldPerTile)),
    row0: Math.max(0, Math.floor(rect.minY / worldPerTile)),
    row1: Math.min(rows - 1, Math.floor(rect.maxY / worldPerTile)),
  };
}

// Every native tile at a level intersecting a world rect, with each tile's
// own world-space rect. Deliberately independent of any app-specific grid
// (e.g. the 2048-unit composite cell pitch): a native tile only ever needs
// fetching and drawing once, at its own position, regardless of which other
// cells it happens to overlap, exactly like any tiled map viewer. Ignores the
// pyramid's 1px tile overlap (a sub-pixel stretch against neighboring tiles):
// acceptable for a first pass.
export function dziTilesForRect(
  info: DziInfo,
  level: number,
  rect: Aabb,
  baseUrl: string,
): { url: string; col: number; row: number; worldRect: Aabb }[] {
  const block = tileBlock(info, level, rect);
  const out: { url: string; col: number; row: number; worldRect: Aabb }[] = [];
  for (let row = block.row0; row <= block.row1; row++) {
    for (let col = block.col0; col <= block.col1; col++) {
      out.push({
        url: `${baseUrl}${level}/${col}_${row}.${info.format}`,
        col,
        row,
        worldRect: {
          minX: col * block.worldPerTile,
          minY: row * block.worldPerTile,
          maxX: Math.min((col + 1) * block.worldPerTile, info.width),
          maxY: Math.min((row + 1) * block.worldPerTile, info.height),
        },
      });
    }
  }
  return out;
}

// The same tiles, each with the world rect its own image really spans: the
// pyramid gives neighbouring tiles a shared overlap margin, so a tile placed at
// its nominal grid rect sits that margin off its neighbour. A badge lays its
// tiles out by these rects and crops them to its box, which is where a pixel of
// slip would show as a seam, and where the shared margin covers the subpixel gap
// a rounded position would otherwise leave.
export function dziTileImages(
  info: DziInfo,
  level: number,
  rect: Aabb,
  baseUrl: string,
): { url: string; worldRect: Aabb }[] {
  const block = tileBlock(info, level, rect);
  const width = levelDimension(info.width, info, level);
  const height = levelDimension(info.height, info, level);
  const out: { url: string; worldRect: Aabb }[] = [];
  for (let row = block.row0; row <= block.row1; row++) {
    for (let col = block.col0; col <= block.col1; col++) {
      const left = col * info.tileSize - (col > 0 ? info.overlap : 0);
      const top = row * info.tileSize - (row > 0 ? info.overlap : 0);
      const right = Math.min(
        (col + 1) * info.tileSize + (col < block.cols - 1 ? info.overlap : 0),
        width,
      );
      const bottom = Math.min(
        (row + 1) * info.tileSize + (row < block.rows - 1 ? info.overlap : 0),
        height,
      );
      out.push({
        url: `${baseUrl}${level}/${col}_${row}.${info.format}`,
        worldRect: {
          minX: left * block.scale,
          minY: top * block.scale,
          maxX: right * block.scale,
          maxY: bottom * block.scale,
        },
      });
    }
  }
  return out;
}
