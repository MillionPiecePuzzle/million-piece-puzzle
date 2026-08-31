// Bookmarks: the player's own notebook of spots on the board, named and
// badged, reached in a click. Client-only and per browser like the personal
// flags (boardFlags.ts), and the whole model lives here: the list rules and the
// localStorage codec, pure so the cap and the parser are unit-tested without
// Vue or Pixi.
//
// Unlike a flag, a bookmark draws nothing on the canvas and nothing on either
// overview, so its count is a non-question: there is no palette identifying an
// entry and no glyph competing for the board, which is what lets the list run to
// MAX_BOOKMARKS instead of to a palette of 8.

export type Bookmark = {
  id: string;
  name: string;
  worldX: number;
  worldY: number;
  zoom: number;
  createdAt: number;
  // Path of an asset the puzzle's own bucket already serves, relative to the
  // manifest: a tile of the reference pyramid today. Never a canvas capture,
  // which would cost a renderer.extract GPU readback, a blob store outside
  // localStorage's quota, and would be lying minutes later on a board a million
  // pieces move across.
  badge: string;
};

export type NewBookmark = Omit<Bookmark, "id" | "createdAt">;

// A cut, not a quota: a notebook has no natural depth the way the flag palette
// has 8, so this is the bound that keeps one hand-edited (or runaway) list from
// costing a page load. An entry runs ~130 bytes, so a full list is ~1.3 MB of
// the origin's localStorage.
export const MAX_BOOKMARKS = 10_000;

// One row, one line: long enough to name a spot ("sky pile, left of the tower"),
// short enough that no name has to be truncated in the list.
export const BOOKMARK_NAME_MAX = 40;

// What one page of the list holds. Paging bounds the DOM nodes and the CDN
// requests an open costs (one badge image per row); the localStorage read is one
// JSON.parse of the whole list either way, a few milliseconds even full.
export const BOOKMARK_PAGE_SIZE = 20;

const STORAGE_PREFIX = "mpp.bookmarks.";

// A badge is only ever a path under this puzzle's own asset base, so a stored
// value can never become an absolute URL to somewhere else or climb out of it.
const BADGE_PATH = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9_-]+)*\.[a-z0-9]{2,5}$/i;

let idCounter = 0;

// Unique within the browser session; bookmarks are per-browser, so a counter
// paired with the mint time is enough and needs no secure-context crypto API.
function nextBookmarkId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function isBadgePath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && BADGE_PATH.test(value);
}

// The name as it is stored: trimmed, and refused rather than cut when it is
// empty or over the cap, so the row always shows what the player typed.
export function normalizeBookmarkName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > BOOKMARK_NAME_MAX) return null;
  return name;
}

// Positions are rounded to the world unit (one source pixel, far under a piece)
// and the zoom to three decimals: a float straight off the camera costs 15
// characters an axis in storage and names a spot no more precisely.
export function addBookmark(list: readonly Bookmark[], entry: NewBookmark): Bookmark[] {
  if (list.length >= MAX_BOOKMARKS) return [...list];
  const bookmark: Bookmark = {
    id: nextBookmarkId(),
    name: entry.name,
    worldX: Math.round(entry.worldX),
    worldY: Math.round(entry.worldY),
    zoom: Math.round(entry.zoom * 1000) / 1000,
    createdAt: Date.now(),
    badge: entry.badge,
  };
  // Newest first: the list is read top-down and the spot just marked is the one
  // being worked in, which also makes the parser's cut drop the oldest entries.
  return [bookmark, ...list];
}

export function removeBookmark(list: readonly Bookmark[], id: string): Bookmark[] {
  return list.filter((b) => b.id !== id);
}

export function filterBookmarks(list: readonly Bookmark[], query: string): Bookmark[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [...list];
  return list.filter((b) => b.name.toLocaleLowerCase().includes(needle));
}

export function bookmarkStorageKey(puzzleId: string): string {
  return `${STORAGE_PREFIX}${puzzleId}`;
}

// localStorage is player-editable and survives a board switch, so a stored list
// is treated as untrusted input: an entry that is not a named, framed, badged
// point is dropped whole, and the list is cut to the cap.
export function parseBookmarks(raw: string | null): Bookmark[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const bookmarks: Bookmark[] = [];
  const takenIds = new Set<string>();
  for (const entry of parsed) {
    if (bookmarks.length >= MAX_BOOKMARKS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, worldX, worldY, zoom, createdAt, badge } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || takenIds.has(id)) continue;
    if (typeof name !== "string") continue;
    const cleanName = normalizeBookmarkName(name);
    if (cleanName === null) continue;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) continue;
    if (!Number.isFinite(zoom) || (zoom as number) <= 0) continue;
    if (!Number.isFinite(createdAt)) continue;
    if (!isBadgePath(badge)) continue;
    bookmarks.push({
      id,
      name: cleanName,
      worldX: worldX as number,
      worldY: worldY as number,
      zoom: zoom as number,
      createdAt: createdAt as number,
      badge,
    });
    takenIds.add(id);
  }
  return bookmarks;
}

export function readBookmarks(puzzleId: string): Bookmark[] {
  try {
    return parseBookmarks(localStorage.getItem(bookmarkStorageKey(puzzleId)));
  } catch {
    return [];
  }
}

export function writeBookmarks(puzzleId: string, list: readonly Bookmark[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(bookmarkStorageKey(puzzleId));
    else localStorage.setItem(bookmarkStorageKey(puzzleId), JSON.stringify(list));
  } catch {
    // Private mode, storage disabled, or a list that outgrew the origin's quota:
    // the notebook stays live for this session only.
  }
}
