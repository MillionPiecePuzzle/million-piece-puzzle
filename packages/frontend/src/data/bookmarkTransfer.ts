// The two ways a bookmark leaves a notebook, neither of them an address: one
// entry as a code that is copied into a message, and the whole notebook as a
// file. A bookmark is a line of a list someone keeps, so what travels is the
// line itself, read back into the recipient's own notebook: a page the game
// serves is not what a saved spot should have to be.
//
// One entry, one line:
//   mppb1:<x>,<y>,<zoom>:<dx>,<dy>,<size>:<name>:<tag>,<tag>
// the place in the player's own coordinates (pieces from the centre of the
// frame, boardCoords.ts) cut to a tenth of a piece, then the zoom to three
// decimals, which is the sender's own camera since a bookmark records no scale.
// The badge square follows, in pieces relative to that point, so it lands on the
// same picture on a board sliced at another piece size, and is empty for the
// entries wearing none. Then the entry as its row reads: the name the player
// wrote (empty where they wrote none, the row reading under its first word) and
// the words it is filed under, both percent-encoded, which is what keeps a comma
// or a colon inside one from being read as the next field. No puzzle id: it
// names a point relative to the frame's centre with one board live at a time.
//
// The whole notebook is a JSON file instead, keyed to the board it was written
// for: it is the player's own list moving between their browsers, so it carries
// every entry whole (its star and its age included) where a code carries one
// spot to someone else.

import {
  BADGE_PIECES_MAX,
  BADGE_PIECES_MIN,
  MAX_TAGS_PER_BOOKMARK,
  normalizeBookmarkName,
  normalizeTagName,
  parseBookmarkList,
  sameTag,
  storedBookmark,
  type Bookmark,
  type BookmarkBadge,
} from "./bookmarks";
import { worldToBoard, type BoardFrame, type BoardPoint } from "../canvas/boardCoords";
import { parseSharedView, type SharedView } from "./viewLink";

// What says a pasted line is a bookmark at all, and which reading it asks for.
export const BOOKMARK_CODE_TAG = "mppb1";
const CODE_FIELDS = 5;

const COORD_DECIMALS = 1;
// Three decimals of zoom: the scale steps of the camera are multiplicative and
// far coarser than a thousandth, so this is the sender's framing and not a
// visible rounding of it.
const ZOOM_DECIMALS = 3;

// The emblem as a code carries it: the square, given in pieces from the shared
// point, which is what keeps it three short numbers on a board whose world
// coordinates run to six digits an axis.
export type SharedBadge = { dx: number; dy: number; size: number };

export type SharedBookmark = {
  view: SharedView;
  name: string;
  badge: SharedBadge | null;
  tags: string[];
};

// Number's own formatting drops trailing zeros, so a whole coordinate costs no
// decimal point in the code.
function short(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

function formatSharedView(view: SharedView): string {
  const x = short(view.x, COORD_DECIMALS);
  const y = short(view.y, COORD_DECIMALS);
  return `${x},${y},${short(view.zoom, ZOOM_DECIMALS)}`;
}

function formatSharedBadge(badge: SharedBadge): string {
  const dx = short(badge.dx, COORD_DECIMALS);
  const dy = short(badge.dy, COORD_DECIMALS);
  return `${dx},${dy},${short(badge.size, COORD_DECIMALS)}`;
}

// One row handed to someone else: the place, and the entry as they will read it
// in their own notebook. The entry's id and its star stay here, since neither is
// about the spot: one is this browser's, the other is what the sender says about
// a place after working it.
export function formatBookmarkCode(bookmark: Bookmark, frame: BoardFrame, zoom: number): string {
  const point = worldToBoard(bookmark.worldX, bookmark.worldY, frame);
  const badge = bookmark.badge;
  const square: SharedBadge | null = badge && {
    dx: (badge.x - bookmark.worldX) / frame.pieceSize,
    dy: (badge.y - bookmark.worldY) / frame.pieceSize,
    size: badge.size / frame.pieceSize,
  };
  return [
    BOOKMARK_CODE_TAG,
    formatSharedView({ ...point, zoom }),
    square ? formatSharedBadge(square) : "",
    encodeURIComponent(bookmark.name),
    bookmark.tags.map(encodeURIComponent).join(","),
  ].join(":");
}

// A code as it arrives from a paste: hand-edited, truncated by a chat client, or
// not a code at all. It is refused whole rather than half-applied, since what it
// fills is a draft the recipient is about to keep.
export function parseBookmarkCode(raw: string): SharedBookmark | null {
  const parts = raw.trim().split(":");
  if (parts.length !== CODE_FIELDS) return null;
  if (parts[0]!.toLowerCase() !== BOOKMARK_CODE_TAG) return null;
  const view = parseSharedView(parts[1]);
  if (view === null) return null;
  const badge = parts[2] === "" ? null : parseSharedBadge(parts[2]);
  if (parts[2] !== "" && badge === null) return null;
  const name = parseSharedName(parts[3]!);
  if (name === null) return null;
  return { view, name, badge, tags: parseSharedTags(parts[4]!) };
}

// A field as it was written, or nothing: a percent sign a chat client mangled
// throws here rather than reaching a name.
function decodeField(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

// The name is trimmed and capped like one the player typed, and empty where the
// sender's own entry reads under no name of its own, which the recipient's
// notebook shows in their language or under the first word it is filed under.
function parseSharedName(raw: string): string | null {
  const text = decodeField(raw);
  return text === null ? null : normalizeBookmarkName(text);
}

// The words the entry is filed under, read like the storage codec reads them: a
// word that is not one is dropped rather than the bookmark it rode in on.
function parseSharedTags(raw: string): string[] {
  if (raw === "") return [];
  const tags: string[] = [];
  for (const field of raw.split(",")) {
    if (tags.length >= MAX_TAGS_PER_BOOKMARK) break;
    const text = decodeField(field);
    if (text === null) continue;
    const name = normalizeTagName(text);
    if (name === null || tags.some((t) => sameTag(t, name))) continue;
    tags.push(name);
  }
  return tags;
}

// The emblem field, which is a stranger's string like any other: the square is
// held to the sizes the panel itself offers, so no code can name one wide enough
// to be worth fetching a level of the pyramid for.
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

function finiteNumber(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// The emblem in the recipient's own world units, anchored on the point their
// camera was sent to rather than on the raw one: the draft they save has to
// badge the spot they are looking at, held inside the same zone.
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

// What a notebook file says it is, so a file picked by mistake is refused by its
// own contents rather than by its name.
export const NOTEBOOK_FILE_KIND = "mpp.bookmarks";
export const NOTEBOOK_FILE_VERSION = 1;

// A full notebook is ~1.5 MB of entries, so anything past this is not one: the
// file comes off the player's disk and is read into memory whole.
export const NOTEBOOK_FILE_MAX_BYTES = 4_000_000;

function fileSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function notebookFileName(puzzleId: string, at: Date): string {
  const day = [
    at.getFullYear(),
    String(at.getMonth() + 1).padStart(2, "0"),
    String(at.getDate()).padStart(2, "0"),
  ].join("-");
  return `bookmarks-${fileSlug(puzzleId) || "board"}-${day}.json`;
}

// The notebook as a file: the same entries the origin's storage holds, under an
// envelope naming the board they were written for. Written by the storage codec
// so one shape is kept in one place, and indented, since a file on a disk is
// something a player can open.
export function notebookFile(puzzleId: string, list: readonly Bookmark[], at: Date): string {
  return JSON.stringify(
    {
      kind: NOTEBOOK_FILE_KIND,
      version: NOTEBOOK_FILE_VERSION,
      puzzleId,
      at: at.toISOString(),
      bookmarks: list.map(storedBookmark),
    },
    null,
    2,
  );
}

// Why a file was refused, since the player picked it themselves and the three
// answers are three different things to do about it: pick another file, open the
// board it was written for, or nothing at all.
export type NotebookFileRead =
  | { kind: "ok"; bookmarks: Bookmark[] }
  | { kind: "other-board"; puzzleId: string }
  | { kind: "bad" };

// A file as it arrives from the disk, treated like the origin's storage is: an
// entry that is not a placed point is dropped and the list is cut to the cap. A
// notebook written for another board is refused whole rather than merged, since
// its coordinates name places on a picture that is not this one.
export function parseNotebookFile(raw: string, puzzleId: string): NotebookFileRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "bad" };
  }
  if (typeof parsed !== "object" || parsed === null) return { kind: "bad" };
  const file = parsed as Record<string, unknown>;
  if (file.kind !== NOTEBOOK_FILE_KIND) return { kind: "bad" };
  if (file.version !== NOTEBOOK_FILE_VERSION) return { kind: "bad" };
  if (typeof file.puzzleId !== "string" || file.puzzleId === "") return { kind: "bad" };
  if (file.puzzleId !== puzzleId) return { kind: "other-board", puzzleId: file.puzzleId };
  return { kind: "ok", bookmarks: parseBookmarkList(file.bookmarks) };
}
