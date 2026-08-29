import type { BoardFlag } from "../data/boardFlags";
import { drawFlagMarkers } from "./flagMarker";
import { paintDensityGrid } from "./overviewDensity";
import type { OverviewSnapshot } from "./puzzleStage";

// Canvas->world mapping a paint produced, captured so a pointer press can invert
// it without recomputing the layout.
export type MapTransform = {
  scale: number;
  offX: number;
  offY: number;
  zoneMinX: number;
  zoneMinY: number;
  margin: number;
};

// Out-of-bounds band: the play zone is inset by this fraction of its larger
// side so a thin margin of outside space shows on every edge. Matches the
// camera padding ring, so the frustum stays inside the band while panning.
const OUTSIDE_MARGIN_FRACTION = 0.04;
const OUTSIDE_FILL = "#ada99e";

// The canvas takes the shape of the play zone (plus its band) so the map fills
// it with no letterbox. Clamped so a strongly non-square zone cannot make the
// panel absurdly short or tall.
export const MIN_OVERVIEW_ASPECT = 1;
const MAX_OVERVIEW_ASPECT = 2;

function mapSize(snap: OverviewSnapshot): { w: number; h: number; margin: number } | null {
  const zone = snap.playZone;
  const zoneW = zone.maxX - zone.minX;
  const zoneH = zone.maxY - zone.minY;
  if (zoneW <= 0 || zoneH <= 0) return null;
  const margin = Math.max(zoneW, zoneH) * OUTSIDE_MARGIN_FRACTION;
  return { w: zoneW + margin * 2, h: zoneH + margin * 2, margin };
}

// Read before painting, so a view sets its element's shape (and appears at that
// shape) without waiting for a frame where the canvas already has a size.
export function overviewAspect(snap: OverviewSnapshot): number | null {
  const map = mapSize(snap);
  if (!map) return null;
  return Math.min(MAX_OVERVIEW_ASPECT, Math.max(MIN_OVERVIEW_ASPECT, map.w / map.h));
}

// Repaints the whole canvas from a fresh stage snapshot: cheap at alpha scale (a
// few thousand fillRects) and keeps the frustum tracking pan and zoom with no
// extra plumbing. Both overview views share it, so the enlarged one is the panel's
// own map at a bigger size rather than a second drawing that can drift from it.
export function drawOverview(
  canvas: HTMLCanvasElement,
  snap: OverviewSnapshot,
  flags: readonly BoardFlag[],
): MapTransform | null {
  const map = mapSize(snap);
  if (!map) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(canvas.clientWidth * dpr);
  const ch = Math.round(canvas.clientHeight * dpr);
  if (cw === 0 || ch === 0) return null;
  if (canvas.width !== cw) canvas.width = cw;
  if (canvas.height !== ch) canvas.height = ch;

  // Paint the whole canvas with the out-of-bounds tone, so the world outside
  // the play zone reads on every side once the zone is inset within it.
  ctx.fillStyle = OUTSIDE_FILL;
  ctx.fillRect(0, 0, cw, ch);

  const zone = snap.playZone;
  const zoneW = zone.maxX - zone.minX;
  const zoneH = zone.maxY - zone.minY;
  const scale = Math.min(cw / map.w, ch / map.h);
  const offX = (cw - map.w * scale) / 2;
  const offY = (ch - map.h * scale) / 2;
  const toX = (wx: number): number => offX + (wx - zone.minX + map.margin) * scale;
  const toY = (wy: number): number => offY + (wy - zone.minY + map.margin) * scale;

  // Play zone interior.
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(toX(zone.minX), toY(zone.minY), zoneW * scale, zoneH * scale);

  // Local known-region overlay (drawn further below) takes precedence over
  // this, so a stale server count never shows under a region the client knows
  // fresh. See overviewDensity.ts.
  paintDensityGrid(ctx, snap, toX, toY, scale);

  // Puzzle frame.
  const fx = toX(0);
  const fy = toY(0);
  const fw = snap.frame.w * scale;
  const fh = snap.frame.h * scale;
  ctx.fillStyle = "rgba(21,20,15,0.05)";
  ctx.fillRect(fx, fy, fw, fh);
  ctx.strokeStyle = "rgba(21,20,15,0.45)";
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeRect(fx, fy, fw, fh);

  // Local known-region overlay: one dot per known piece (the visited regions the
  // client has fresh positions for), refining the coarse grid. Loose first,
  // locked on top so progress reads. Empty for a contributor's far-zoomed fit
  // (no regions built yet), where the grid alone carries the overview.
  const dot = Math.max(1, 1.8 * dpr);
  const half = dot / 2;
  ctx.fillStyle = "rgba(21,20,15,0.5)";
  for (const p of snap.pieces) {
    if (!p.locked) ctx.fillRect(toX(p.x) - half, toY(p.y) - half, dot, dot);
  }
  ctx.fillStyle = "rgba(21,20,15,0.85)";
  for (const p of snap.pieces) {
    if (p.locked) ctx.fillRect(toX(p.x) - half, toY(p.y) - half, dot, dot);
  }

  // Camera frustum.
  if (snap.viewport) {
    const v = snap.viewport;
    const x = toX(v.worldX);
    const y = toY(v.worldY);
    const w = v.worldW * scale;
    const h = v.worldH * scale;
    ctx.fillStyle = "rgba(213,135,90,0.14)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgb(213,135,90)";
    ctx.lineWidth = Math.max(1, 1.5 * dpr);
    ctx.strokeRect(x, y, w, h);
  }

  drawFlagMarkers(ctx, flags, toX, toY, dpr);

  return { scale, offX, offY, zoneMinX: zone.minX, zoneMinY: zone.minY, margin: map.margin };
}
