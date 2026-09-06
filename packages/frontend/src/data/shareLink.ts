// Handing a spot on the board to someone else: `/play?at=<x>,<y>,<zoom>` in the
// player's own coordinates (pieces from the centre of the frame, boardCoords.ts).
// One parameter rather than three so a paste into a chat stays one short line,
// and the numbers are cut for the same reason: a tenth of a piece is already
// finer than the spot anyone means.
//
// A link copied from a bookmark carries that bookmark too, in one or two more
// parameters: `n` for the name, and `b` for the emblem when the entry wears one.
// The emblem is the square in pieces relative to the shared point, three short
// numbers rather than the six digits an axis a world rect costs; a spot off the
// picture has none and its link carries none. What arrives is a draft and never
// an entry: the recipient reads the name a stranger wrote, changes it if they
// want to, and it is their save that writes it to their notebook.

import {
  boardToWorld,
  clampWorldToZone,
  worldToBoard,
  type BoardFrame,
  type BoardPoint,
} from "../canvas/boardCoords";
import {
  BADGE_PIECES_MAX,
  BADGE_PIECES_MIN,
  bookmarkLabel,
  normalizeBookmarkName,
  type Bookmark,
  type BookmarkBadge,
} from "./bookmarks";
import type { PlayZone } from "@mpp/shared";

export const SHARE_VIEW_PARAM = "at";
export const SHARE_BADGE_PARAM = "b";
export const SHARE_NAME_PARAM = "n";

export type SharedView = { x: number; y: number; zoom: number };

// The emblem as a link carries it: the square, given in pieces from the shared
// point, which is what keeps it three numbers on a board whose world coordinates
// run to six digits an axis.
export type SharedBadge = { dx: number; dy: number; size: number };

export type SharedBookmark = { name: string; badge: SharedBadge | null };

const COORD_DECIMALS = 1;
// Three decimals of zoom: the scale steps of the camera are multiplicative and
// far coarser than a thousandth, so this is the sender's framing and not a
// visible rounding of it.
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

export function formatSharedBadge(badge: SharedBadge): string {
  const dx = short(badge.dx, COORD_DECIMALS);
  const dy = short(badge.dy, COORD_DECIMALS);
  return `${dx},${dy},${short(badge.size, COORD_DECIMALS)}`;
}

export function shareUrl(
  origin: string,
  view: SharedView,
  bookmark: SharedBookmark | null,
): string {
  const at = `${SHARE_VIEW_PARAM}=${formatSharedView(view)}`;
  if (!bookmark) return `${origin}/play?${at}`;
  const name = `${SHARE_NAME_PARAM}=${encodeURIComponent(bookmark.name)}`;
  // The name is what says a link carries a bookmark, so an entry wearing no
  // emblem simply travels without one rather than with an empty parameter.
  if (!bookmark.badge) return `${origin}/play?${at}&${name}`;
  const badge = `${SHARE_BADGE_PARAM}=${formatSharedBadge(bookmark.badge)}`;
  return `${origin}/play?${at}&${badge}&${name}`;
}

// A bookmark's own link: the spot in player coordinates, and the entry as the
// draft the recipient is offered. The emblem's square travels relative to the
// point and in pieces, so it lands on the same picture on a board sliced at
// another piece size. The zoom is the sender's own, since a bookmark records no
// scale: what the recipient lands at is what the sender was looking at.
export function bookmarkShareUrl(
  origin: string,
  bookmark: Bookmark,
  frame: BoardFrame,
  zoom: number,
): string {
  const point = worldToBoard(bookmark.worldX, bookmark.worldY, frame);
  const badge = bookmark.badge;
  const shared: SharedBadge | null = badge && {
    dx: (badge.x - bookmark.worldX) / frame.pieceSize,
    dy: (badge.y - bookmark.worldY) / frame.pieceSize,
    size: badge.size / frame.pieceSize,
  };
  // The name the sender's own row shows, which for an unnamed entry is the word
  // it is filed under: what travels is what they see, and it is empty only when
  // they see nothing either, since the stand-in the panel draws then is in their
  // language and not the recipient's.
  return shareUrl(origin, { ...point, zoom }, { name: bookmarkLabel(bookmark), badge: shared });
}

// A link as it arrives from a paste rather than from the address bar: the whole
// URL, or the query alone, since what someone copies out of a chat is not always
// the line they were sent. Only the parameters are read from it, so a stranger's
// origin never reaches the page, and a half link (a framing with no bookmark on
// it) is refused here rather than offered as a draft that cannot be saved.
export type SharedLink = { view: SharedView; bookmark: SharedBookmark };

export function parseShareLink(raw: string): SharedLink | null {
  const params = shareLinkParams(raw);
  if (!params) return null;
  const view = parseSharedView(params.get(SHARE_VIEW_PARAM));
  const bookmark = parseSharedBookmark(params.get(SHARE_NAME_PARAM), params.get(SHARE_BADGE_PARAM));
  return view && bookmark ? { view, bookmark } : null;
}

// A fragment is cut before the split: the name is percent-encoded, so a `#` in
// the pasted line is the address bar's own and never part of a parameter.
function shareLinkParams(raw: string): URLSearchParams | null {
  const text = raw.trim().split("#")[0]!;
  const query = text.indexOf("?");
  if (query >= 0) return new URLSearchParams(text.slice(query + 1));
  return text.includes("=") ? new URLSearchParams(text) : null;
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

// The emblem parameter, which is a stranger's string like any other: the square
// is held to the sizes the panel itself offers, so no link can name one wide
// enough to be worth fetching a level of the pyramid for.
export function parseSharedBadge(raw: unknown): SharedBadge | null {
  if (typeof raw !== "string" || raw === "") return null;
  const parts = raw.split(",");
  if (parts.length !== 3) return null;
  const dx = finiteNumber(parts[0]!);
  const dy = finiteNumber(parts[1]!);
  const size = finiteNumber(parts[2]!);
  if (dx === null || dy === null || size === null) return null;
  if (size < BADGE_PIECES_MIN || size > BADGE_PIECES_MAX) return null;
  return { dx, dy, size };
}

// The draft a link offers, or nothing: the name is what says the link carries a
// bookmark at all, so an emblem with no name parameter is not the bookmark that
// was shared and is refused. The name is trimmed and capped like one the player
// typed, and empty where the sender's own entry reads under no word, which the
// recipient's notebook shows in their language.
//
// No emblem parameter is a whole bookmark and not a half one: a spot off the
// picture wears none. A parameter that is there and reads as no square is
// refused, one written when a bookmark could stand for a loose piece excepted,
// which carried a tile path (no comma in it) and lands on the default badge like
// any spot with no picture under it.
export function parseSharedBookmark(nameRaw: unknown, badgeRaw: unknown): SharedBookmark | null {
  if (typeof nameRaw !== "string") return null;
  const name = normalizeBookmarkName(nameRaw);
  if (name === null) return null;
  if (badgeRaw === undefined || badgeRaw === null) return { name, badge: null };
  if (typeof badgeRaw === "string" && !badgeRaw.includes(",")) return { name, badge: null };
  const badge = parseSharedBadge(badgeRaw);
  return badge === null ? null : { name, badge };
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
  return clampWorldToZone(boardToWorld(view.x, view.y, frame), zone);
}

// The emblem in the recipient's own world units, anchored on the point their
// camera was sent to rather than on the raw one: the draft they save has to badge
// the spot they are looking at, held inside the same zone.
export function sharedBadgeToBadge(
  badge: SharedBadge | null,
  point: BoardPoint,
  frame: BoardFrame,
): BookmarkBadge | null {
  if (badge === null) return null;
  return {
    x: point.x + badge.dx * frame.pieceSize,
    y: point.y + badge.dy * frame.pieceSize,
    size: badge.size * frame.pieceSize,
  };
}
