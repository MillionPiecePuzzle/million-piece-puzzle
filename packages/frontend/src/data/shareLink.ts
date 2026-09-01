// Handing a spot on the board to someone else: `/play?at=<x>,<y>,<zoom>` in the
// player's own coordinates (pieces from the centre of the frame, boardCoords.ts).
// One parameter rather than three so a paste into a chat stays one short line,
// and the numbers are cut for the same reason: a tenth of a piece is already
// finer than the spot anyone means.
//
// The link carries a framing and nothing else. It names no bookmark, since the
// recipient has none to put a badge on, and a spot is the whole of what is being
// handed over.

import { boardToWorld, type BoardFrame, type BoardPoint } from "../canvas/boardCoords";
import type { PlayZone } from "@mpp/shared";

export const SHARE_VIEW_PARAM = "at";

export type SharedView = { x: number; y: number; zoom: number };

const COORD_DECIMALS = 1;
// The three a bookmark stores its zoom at, so a link built from one restores the
// framing it recorded rather than a rounding of it.
const ZOOM_DECIMALS = 3;

// Number's own formatting drops trailing zeros, so a whole coordinate costs no
// decimal point in the link.
function short(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

export function formatSharedView(view: SharedView): string {
  const x = short(view.x, COORD_DECIMALS);
  const y = short(view.y, COORD_DECIMALS);
  return `${x},${y},${short(view.zoom, ZOOM_DECIMALS)}`;
}

export function shareViewUrl(origin: string, view: SharedView): string {
  return `${origin}/play?${SHARE_VIEW_PARAM}=${formatSharedView(view)}`;
}

function finiteNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// The parameter as it arrives: hand-edited, truncated by a chat client, or
// absent. Anything that is not three finite numbers is refused whole rather than
// half-applied, a NaN reaching the camera taking the board with it.
export function parseSharedView(raw: unknown): SharedView | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split(",");
  if (parts.length !== 3) return null;
  const x = finiteNumber(parts[0]!);
  const y = finiteNumber(parts[1]!);
  const zoom = finiteNumber(parts[2]!);
  if (x === null || y === null || zoom === null) return null;
  return { x, y, zoom };
}

// The world point a shared view frames, held inside the play zone: a link can
// name a point off the board (an edited number, a board scattered narrower since
// it was written), and the zone is the same bound a pan stops at. The zoom is
// clamped by the stage instead, against the limits it owns.
export function sharedViewWorldPoint(
  view: SharedView,
  frame: BoardFrame,
  zone: PlayZone,
): BoardPoint {
  const world = boardToWorld(view.x, view.y, frame);
  return {
    x: Math.min(Math.max(world.x, zone.minX), zone.maxX),
    y: Math.min(Math.max(world.y, zone.minY), zone.maxY),
  };
}
