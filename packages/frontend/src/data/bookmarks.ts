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

// What stands for a spot in its row. Either a square of the board, stored in
// world units and drawn from whatever pyramid tiles cover it, or the tile of one
// loose piece, named by the path the manifest gave it. Never a canvas capture,
// which would cost a renderer.extract GPU readback, a blob store outside
// localStorage's quota, and would be lying minutes later on a board a million
// pieces move across.
export type BookmarkBadge =
  | { kind: "piece"; file: string }
  | { kind: "area"; x: number; y: number; size: number };

export type Bookmark = {
  id: string;
  name: string;
  worldX: number;
  worldY: number;
  createdAt: number;
  badge: BookmarkBadge;
  // The spots the player keeps coming back to, held at the top of the list. A
  // flag rather than a slot: there is no cap on it, since it orders the notebook
  // and never competes for anything on the board.
  favorite: boolean;
  // The player's own words for this bookmark, the whole of the notebook's
  // classification. Nothing here knows what one means, so whether "cats" and
  // "still to place" are two tags or one is entirely the player's call.
  tags: string[];
};

// Nothing is born a favorite: it is what the player says about a bookmark after
// working it, so a new entry (their own, or one saved from a link) starts plain.
// Tags are not part of the place either, so they reach `addBookmark` beside the
// entry rather than inside it.
export type NewBookmark = Omit<Bookmark, "id" | "createdAt" | "favorite" | "tags">;

// The two views the selector offers that are not a tag. A tag view carries the
// tag behind a prefix, so a bookmark tagged "all" is still its own view.
export const VIEW_ALL = "all";
export const VIEW_UNTAGGED = "untagged";
const VIEW_TAG_PREFIX = "t:";

export function tagView(tag: string): string {
  return VIEW_TAG_PREFIX + tag;
}

export function viewTag(view: string): string | null {
  return view.startsWith(VIEW_TAG_PREFIX) ? view.slice(VIEW_TAG_PREFIX.length) : null;
}

// Which of the two badges the next spot is marked with, chosen before the aim
// rather than decided by what happens to be under the click: the player says
// whether this spot is a piece or a square of the board, and the aim takes that
// and nothing else.
export type BadgeKind = BookmarkBadge["kind"];

// The badge square's side, in pieces. A photo of a board like this one holds 8 to
// 12 pieces, which is what a place looks like to the eye, so that is the middle
// of the range and the default; the ends are one pile and one whole corner.
export const BADGE_PIECES_MIN = 4;
export const BADGE_PIECES_MAX = 24;
export const BADGE_PIECES_DEFAULT = 12;

// A cut, not a quota: a notebook has no natural depth the way the flag palette
// has 8, so this is the bound that keeps one hand-edited (or runaway) list from
// costing a page load. An entry runs ~150 bytes, so a full list is ~1.5 MB of
// the origin's localStorage.
export const MAX_BOOKMARKS = 10_000;

// One row, one line: long enough to name a spot ("sky pile, left of the tower"),
// short enough that no name has to be truncated in the list.
export const BOOKMARK_NAME_MAX = 40;

// What one bookmark can wear. Five words about one place is already more than a
// row can show, and the bound is what keeps the picker a choice rather than a
// second notebook to keep.
export const MAX_TAGS_PER_BOOKMARK = 5;

// The distinct tags one notebook can hold, a cut for the same reason
// MAX_BOOKMARKS is one: localStorage is player-editable, so the parser bounds
// what a page load can cost. A full notebook wearing five each could name
// 50 000 different words; nobody sorting their own meets this.
export const MAX_TAGS = 10_000;

// A tag labels a selector option and rides a row beside the coordinates, where a
// bookmark name is a whole sentence about one place.
export const TAG_NAME_MAX = 24;

// What one page of the list holds. Paging bounds the DOM nodes and the CDN
// requests an open costs (one badge image per row); the localStorage read is one
// JSON.parse of the whole list either way, a few milliseconds even full. Ten
// rows is what the panel shows without the list itself becoming the scroll.
export const BOOKMARK_PAGE_SIZE = 10;

const STORAGE_PREFIX = "mpp.bookmarks.";

// A piece badge is only ever the tile path the manifest gave for that piece,
// relative to this puzzle's own asset base, so a stored or shared value can never
// become an absolute URL to somewhere else or climb out of the bucket.
const PIECE_FILE = /^pieces\/[a-z0-9_-]+\/[a-z0-9_-]+\.[a-z0-9]{2,5}$/i;

let idCounter = 0;

// Unique within the browser session; bookmarks are per-browser, so a counter
// paired with the mint time is enough and needs no secure-context crypto API.
function nextBookmarkId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// Two tags are the same tag whatever their capitals: a notebook holding both
// "Chats" and "chats" would split one classification in two without ever saying
// so, and the selector would show the same word twice.
export function sameTag(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

export function isPieceFile(value: unknown): value is string {
  return typeof value === "string" && value.length <= 120 && PIECE_FILE.test(value);
}

// A badge as it arrives from storage or from a link: rebuilt field by field
// rather than passed through, so nothing an entry carries beyond the two shapes
// reaches the row. A square is refused rather than clamped when it has no side,
// since a badge of no width would draw nothing.
export function parseBookmarkBadge(value: unknown): BookmarkBadge | null {
  if (typeof value !== "object" || value === null) return null;
  const { kind, file, x, y, size } = value as Record<string, unknown>;
  if (kind === "piece") return isPieceFile(file) ? { kind, file } : null;
  if (kind !== "area") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!Number.isFinite(size) || (size as number) <= 0) return null;
  return { kind, x: x as number, y: y as number, size: size as number };
}

// The name as it is stored: trimmed, and refused rather than cut when it is
// empty or over the cap, so the row always shows what the player typed.
export function normalizeBookmarkName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > BOOKMARK_NAME_MAX) return null;
  return name;
}

export function normalizeTagName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > TAG_NAME_MAX) return null;
  return name;
}

// Every tag the notebook holds, which is every word at least one bookmark wears
// and nothing else: there is no list of tags anywhere, so a tag is born on the
// bookmark that first wears it and goes with the last one that drops it. The
// first spelling met wins, so a tag typed back with other capitals stays the one
// word it already was.
export function allTags(list: readonly Bookmark[]): string[] {
  const seen = new Map<string, string>();
  for (const bookmark of list) {
    for (const tag of bookmark.tags) {
      const key = tag.toLocaleLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function hasAnyTag(tags: readonly string[], tag: string): boolean {
  return tags.some((t) => sameTag(t, tag));
}

export function hasTag(bookmark: Bookmark, tag: string): boolean {
  return hasAnyTag(bookmark.tags, tag);
}

// The spelling the notebook already knows for this word, so tagging a second
// bookmark "chats" when the first wears "Chats" joins that tag instead of
// standing a near-twin of it next to it in the selector.
export function knownTagSpelling(list: readonly Bookmark[], tag: string): string {
  for (const bookmark of list) {
    const known = bookmark.tags.find((t) => sameTag(t, tag));
    if (known !== undefined) return known;
  }
  return tag;
}

// One set of tags with a word added, the rule an entry goes through whether it
// is kept in the notebook or still being written: no duplicate, nothing past the
// cap, and the same order in both. Refused rather than trimmed at the cap: the
// picker says the bookmark is full and the player drops one, instead of a sixth
// silently going nowhere.
export function withTag(tags: readonly string[], tag: string): string[] {
  if (hasAnyTag(tags, tag) || tags.length >= MAX_TAGS_PER_BOOKMARK) return [...tags];
  return [...tags, tag].sort((a, b) => a.localeCompare(b));
}

export function withoutTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => !sameTag(t, tag));
}

export function addTag(list: readonly Bookmark[], id: string, tag: string): Bookmark[] {
  const spelling = knownTagSpelling(list, tag);
  return list.map((b) => (b.id === id ? { ...b, tags: withTag(b.tags, spelling) } : b));
}

export function removeTag(list: readonly Bookmark[], id: string, tag: string): Bookmark[] {
  return list.map((b) => (b.id === id ? { ...b, tags: withoutTag(b.tags, tag) } : b));
}

// Positions are rounded to the world unit (one source pixel, far under a piece):
// a float straight off the board costs 15 characters an axis in storage and names
// a spot no more precisely. The badge square is a position too, so it is rounded
// the same way.
function roundBadge(badge: BookmarkBadge): BookmarkBadge {
  if (badge.kind === "piece") return badge;
  return {
    kind: "area",
    x: Math.round(badge.x),
    y: Math.round(badge.y),
    size: Math.round(badge.size),
  };
}

// The one order the notebook is ever in, kept by every writer so the stored list
// and the page the panel shows agree: favorites first, then by name inside each
// block. A name is what the player wrote to find the place again, so it is what
// they look down the list for; an age is not something anyone reads a notebook
// by, and it moved a row every time another was added.
export function sortBookmarks(list: readonly Bookmark[]): Bookmark[] {
  return [...list].sort((a, b) =>
    a.favorite === b.favorite ? a.name.localeCompare(b.name) : a.favorite ? -1 : 1,
  );
}

export function addBookmark(
  list: readonly Bookmark[],
  entry: NewBookmark,
  tags: readonly string[] = [],
): Bookmark[] {
  if (list.length >= MAX_BOOKMARKS) return [...list];
  const bookmark: Bookmark = {
    id: nextBookmarkId(),
    name: entry.name,
    worldX: Math.round(entry.worldX),
    worldY: Math.round(entry.worldY),
    createdAt: Date.now(),
    badge: roundBadge(entry.badge),
    favorite: false,
    tags: tags.slice(0, MAX_TAGS_PER_BOOKMARK).map((t) => knownTagSpelling(list, t)),
  };
  return sortBookmarks([bookmark, ...list]);
}

// What the selector narrows the list to, the name filter applying after it.
export function bookmarksInView(list: readonly Bookmark[], view: string): Bookmark[] {
  if (view === VIEW_ALL) return [...list];
  if (view === VIEW_UNTAGGED) return list.filter((b) => b.tags.length === 0);
  const tag = viewTag(view);
  if (tag === null) return [];
  return list.filter((b) => hasTag(b, tag));
}

export function removeBookmark(list: readonly Bookmark[], id: string): Bookmark[] {
  return list.filter((b) => b.id !== id);
}

// Starring an entry moves it, so the list is re-sorted rather than left with a
// favorite sitting where it was written: the row the player just starred is at
// the top when they look again.
export function toggleBookmarkFavorite(list: readonly Bookmark[], id: string): Bookmark[] {
  return sortBookmarks(list.map((b) => (b.id === id ? { ...b, favorite: !b.favorite } : b)));
}

export function filterBookmarks(list: readonly Bookmark[], query: string): Bookmark[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [...list];
  return list.filter((b) => b.name.toLocaleLowerCase().includes(needle));
}

export function bookmarkStorageKey(puzzleId: string): string {
  return `${STORAGE_PREFIX}${puzzleId}`;
}

// An entry's tags as they arrive from storage: read against the notebook's
// running set of distinct tags, which is where both caps land. A word past the
// notebook's own bound is dropped rather than the entry it rode in on, and a
// spelling the file already used earlier wins over a later one.
function parseTags(value: unknown, distinct: Map<string, string>): string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const raw of value) {
    if (tags.length >= MAX_TAGS_PER_BOOKMARK) break;
    if (typeof raw !== "string") continue;
    const name = normalizeTagName(raw);
    if (name === null) continue;
    if (tags.some((t) => sameTag(t, name))) continue;
    const key = name.toLocaleLowerCase();
    const known = distinct.get(key);
    if (known === undefined && distinct.size >= MAX_TAGS) continue;
    if (known === undefined) distinct.set(key, name);
    tags.push(known ?? name);
  }
  return tags.sort((a, b) => a.localeCompare(b));
}

// localStorage is player-editable and survives a board switch, so a stored list
// is treated as untrusted input: an entry that is not a named, placed, badged
// point is dropped whole, the list is cut to the cap, and anything an entry
// carries beyond those fields (a zoom an older notebook stored) is left behind.
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
  const distinctTags = new Map<string, string>();
  for (const entry of parsed) {
    if (bookmarks.length >= MAX_BOOKMARKS) break;
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, worldX, worldY, createdAt, badge, favorite, tags } = entry as Record<
      string,
      unknown
    >;
    if (typeof id !== "string" || id === "" || takenIds.has(id)) continue;
    if (typeof name !== "string") continue;
    const cleanName = normalizeBookmarkName(name);
    if (cleanName === null) continue;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) continue;
    if (!Number.isFinite(createdAt)) continue;
    const cleanBadge = parseBookmarkBadge(badge);
    if (cleanBadge === null) continue;
    bookmarks.push({
      id,
      name: cleanName,
      worldX: worldX as number,
      worldY: worldY as number,
      createdAt: createdAt as number,
      badge: cleanBadge,
      favorite: favorite === true,
      tags: parseTags(tags, distinctTags),
    });
    takenIds.add(id);
  }
  // Sorted on the way in as well as on the way out: a hand-edited file, or one
  // written before favorites existed, still opens in the order the panel pages.
  return sortBookmarks(bookmarks);
}

export function readBookmarks(puzzleId: string): Bookmark[] {
  try {
    return parseBookmarks(localStorage.getItem(bookmarkStorageKey(puzzleId)));
  } catch {
    return [];
  }
}

// The other half of the codec, written field by field like the parser reads:
// a plain entry carries no flag at all, since the notebook is mostly plain
// entries and `"favorite":false` on each of them is 17 bytes of a quota the cap
// is measured against. What is absent reads as false on the way back in.
export function serializeBookmarks(list: readonly Bookmark[]): string {
  return JSON.stringify(
    list.map((b) => {
      const stored: Record<string, unknown> = {
        id: b.id,
        name: b.name,
        worldX: b.worldX,
        worldY: b.worldY,
        createdAt: b.createdAt,
        badge: b.badge,
      };
      if (b.favorite) stored.favorite = true;
      if (b.tags.length > 0) stored.tags = b.tags;
      return stored;
    }),
  );
}

export function writeBookmarks(puzzleId: string, list: readonly Bookmark[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(bookmarkStorageKey(puzzleId));
    else localStorage.setItem(bookmarkStorageKey(puzzleId), serializeBookmarks(list));
  } catch {
    // Private mode, storage disabled, or a list that outgrew the origin's quota:
    // the notebook stays live for this session only.
  }
}
