// Deep Zoom Image (DZI) tile math for the reference photo pyramid (see
// packages/shared/src/manifest.ts's doc comment and scripts/slice-image.ts's
// `sharp().tile({ layout: "dz", ... })`). Spike-only (see ROADMAP backlog: DZI
// native in Pixi).

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

// The coarsest per-cell mask/seam LOD tier (see cellCompositor.ts's
// bakeTiers, same CELL_MASK_TIER_FACTORS) that still meets the current
// zoom's resolution need, so a min-zoom overview never has to decode a
// full-resolution silhouette for every resident cell (see DECISIONS: DZI
// reveal mask/seam LOD tiers). "Need" is expressed as a downscale factor
// from native (1 world unit = 1 native pixel, this codebase's zoom
// convention): at zoom>=1 nothing is downscaled (tier 0), at zoom<1
// progressively coarser tiers suffice. Picks the coarsest tier whose own
// factor does not exceed what is needed, so the mask is never blurrier
// than the zoom warrants.
export function maskTierForZoom(zoom: number): number {
  const neededDownscale = Math.max(1, 1 / zoom);
  let tier = 0;
  for (let i = 0; i < CELL_MASK_TIER_FACTORS.length; i++) {
    if (CELL_MASK_TIER_FACTORS[i]! <= neededDownscale) tier = i;
  }
  return tier;
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
  const worldPerTile = info.tileSize * 2 ** (info.maxLevel - level);
  const colsAtLevel = Math.ceil(levelDimension(info.width, info, level) / info.tileSize);
  const rowsAtLevel = Math.ceil(levelDimension(info.height, info, level) / info.tileSize);
  const col0 = Math.max(0, Math.floor(rect.minX / worldPerTile));
  const col1 = Math.min(colsAtLevel - 1, Math.floor(rect.maxX / worldPerTile));
  const row0 = Math.max(0, Math.floor(rect.minY / worldPerTile));
  const row1 = Math.min(rowsAtLevel - 1, Math.floor(rect.maxY / worldPerTile));
  const out: { url: string; col: number; row: number; worldRect: Aabb }[] = [];
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      out.push({
        url: `${baseUrl}${level}/${col}_${row}.${info.format}`,
        col,
        row,
        worldRect: {
          minX: col * worldPerTile,
          minY: row * worldPerTile,
          maxX: Math.min((col + 1) * worldPerTile, info.width),
          maxY: Math.min((row + 1) * worldPerTile, info.height),
        },
      });
    }
  }
  return out;
}
