// A framing named in the address bar: `/play?at=<x>,<y>,<zoom>` in the player's
// own coordinates (pieces from the centre of the frame, boardCoords.ts). One
// parameter rather than three, and the numbers cut, since a line like this is
// written by hand into a post or a message: a tenth of a piece is already finer
// than the spot anyone means.
//
// Nothing in the game writes one. A bookmark travels as itself rather than as a
// URL (bookmarkTransfer.ts); what is read here is a place and never an entry, so
// no word anyone typed ever rides in an address bar.

import {
  boardToWorld,
  clampWorldToZone,
  type BoardFrame,
  type BoardPoint,
} from "../canvas/boardCoords";
import type { PlayZone } from "@mpp/shared";

export const SHARE_VIEW_PARAM = "at";

export type SharedView = { x: number; y: number; zoom: number };

function finiteNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// The parameter as it arrives: hand-written, truncated by a chat client, or
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

// The world point a shared view frames, held inside the play zone: a line can
// name a point off the board (a typo, a board scattered narrower since it was
// written), and the zone is the same bound a pan stops at. The zoom is clamped
// by the stage instead, against the limits it owns.
export function sharedViewWorldPoint(
  view: SharedView,
  frame: BoardFrame,
  zone: PlayZone,
): BoardPoint {
  return clampWorldToZone(boardToWorld(view.x, view.y, frame), zone);
}
