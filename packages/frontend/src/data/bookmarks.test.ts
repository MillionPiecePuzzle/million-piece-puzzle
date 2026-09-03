import { describe, it, expect } from "vitest";
import {
  BOOKMARK_NAME_MAX,
  MAX_BOOKMARKS,
  addBookmark,
  filterBookmarks,
  isPieceFile,
  normalizeBookmarkName,
  parseBookmarkBadge,
  parseBookmarks,
  removeBookmark,
  serializeBookmarks,
  sortBookmarks,
  toggleBookmarkFavorite,
  type Bookmark,
  type BookmarkBadge,
} from "./bookmarks";

const BADGE: BookmarkBadge = { kind: "area", x: 1200, y: 2400, size: 1440 };
const PIECE_BADGE: BookmarkBadge = { kind: "piece", file: "pieces/0123/012345.avif" };

function make(name: string, list: readonly Bookmark[] = []): Bookmark[] {
  return addBookmark(list, { name, worldX: 10, worldY: 20, badge: BADGE });
}

describe("addBookmark", () => {
  it("puts the newest entry first", () => {
    const list = make("second", make("first"));
    expect(list.map((b) => b.name)).toEqual(["second", "first"]);
  });

  it("rounds the position to the world unit", () => {
    const [saved] = addBookmark([], {
      name: "spot",
      worldX: 1234.56,
      worldY: -78.9,
      badge: BADGE,
    });
    expect(saved).toMatchObject({ worldX: 1235, worldY: -79 });
  });

  it("records a place and no scale, so a jump keeps the zoom the player is at", () => {
    const [saved] = make("spot");
    expect(saved).not.toHaveProperty("zoom");
  });

  it("rounds the badge square to the world unit and leaves a piece alone", () => {
    const [square] = addBookmark([], {
      name: "spot",
      worldX: 0,
      worldY: 0,
      badge: { kind: "area", x: 11.4, y: -22.6, size: 1440.2 },
    });
    expect(square!.badge).toEqual({ kind: "area", x: 11, y: -23, size: 1440 });
    const [piece] = addBookmark([], {
      name: "spot",
      worldX: 0,
      worldY: 0,
      badge: PIECE_BADGE,
    });
    expect(piece!.badge).toEqual(PIECE_BADGE);
  });

  it("mints distinct ids", () => {
    let list: Bookmark[] = [];
    for (let i = 0; i < 50; i++) list = make(`spot ${i}`, list);
    expect(new Set(list.map((b) => b.id)).size).toBe(50);
  });

  it("refuses to grow past the cap", () => {
    const full = Array.from({ length: MAX_BOOKMARKS }, (_, i) => ({
      id: `b${i}`,
      name: `spot ${i}`,
      worldX: 0,
      worldY: 0,
      createdAt: 0,
      badge: BADGE,
      favorite: false,
    }));
    expect(make("one more", full)).toHaveLength(MAX_BOOKMARKS);
  });

  it("starts a new entry plain, favorites being what the player says afterwards", () => {
    const [saved] = make("spot");
    expect(saved!.favorite).toBe(false);
  });

  it("lands a new entry under the favorites rather than above them", () => {
    const kept = make("kept");
    const starred = toggleBookmarkFavorite(kept, kept[0]!.id);
    const list = addBookmark(starred, { name: "fresh", worldX: 0, worldY: 0, badge: BADGE });
    expect(list.map((b) => b.name)).toEqual(["kept", "fresh"]);
  });
});

// createdAt is minted by the clock, so these are built by hand: what is under
// test is the order two entries come out in, not when they were made.
function entry(name: string, createdAt: number, favorite = false): Bookmark {
  return { id: name, name, worldX: 0, worldY: 0, createdAt, badge: BADGE, favorite };
}

describe("sortBookmarks", () => {
  it("puts the favorites first and the newest first inside each block", () => {
    const list = sortBookmarks([
      entry("old", 100),
      entry("old favorite", 100, true),
      entry("new", 300),
      entry("new favorite", 300, true),
    ]);
    expect(list.map((b) => b.name)).toEqual(["new favorite", "old favorite", "new", "old"]);
  });
});

describe("toggleBookmarkFavorite", () => {
  it("raises the starred entry to the top and drops it back when unstarred", () => {
    const list = [entry("old", 100), entry("new", 300)];
    const starred = toggleBookmarkFavorite(list, "old");
    expect(starred.map((b) => b.name)).toEqual(["old", "new"]);
    expect(starred[0]!.favorite).toBe(true);
    expect(toggleBookmarkFavorite(starred, "old").map((b) => b.name)).toEqual(["new", "old"]);
  });

  it("leaves the rest of the list alone", () => {
    const list = [entry("a", 300), entry("b", 100)];
    expect(toggleBookmarkFavorite(list, "nobody")).toEqual(list);
  });
});

describe("removeBookmark", () => {
  it("drops the named entry and leaves the rest", () => {
    const list = make("b", make("a"));
    expect(removeBookmark(list, list[0]!.id).map((b) => b.name)).toEqual(["a"]);
  });
});

describe("normalizeBookmarkName", () => {
  it("trims", () => {
    expect(normalizeBookmarkName("  sky pile  ")).toBe("sky pile");
  });

  it("refuses an empty or blank name", () => {
    expect(normalizeBookmarkName("   ")).toBeNull();
  });

  it("refuses a name past the cap", () => {
    expect(normalizeBookmarkName("x".repeat(BOOKMARK_NAME_MAX + 1))).toBeNull();
  });
});

describe("isPieceFile", () => {
  it("takes the tile path the manifest gives a piece", () => {
    expect(isPieceFile("pieces/0123/012345.avif")).toBe(true);
  });

  it("refuses anything that is not a piece path under this bucket", () => {
    for (const bad of [
      "https://elsewhere.example/pieces/0123/012345.avif",
      "javascript:alert(1)",
      "/pieces/0123/012345.avif",
      "pieces/../../etc/passwd",
      "pieces/0123/012345",
      "source_files/12/3_4.webp",
      "",
      42,
      null,
    ]) {
      expect(isPieceFile(bad), String(bad)).toBe(false);
    }
  });
});

describe("parseBookmarkBadge", () => {
  it("reads back a square and a piece", () => {
    expect(parseBookmarkBadge({ ...BADGE })).toEqual(BADGE);
    expect(parseBookmarkBadge({ ...PIECE_BADGE })).toEqual(PIECE_BADGE);
  });

  it("keeps nothing an entry carries beyond the badge itself", () => {
    expect(parseBookmarkBadge({ ...BADGE, onload: "alert(1)" })).toEqual(BADGE);
  });

  it("refuses a badge that is neither a drawable square nor a piece", () => {
    for (const bad of [
      null,
      "pieces/0123/012345.avif",
      { kind: "photo", x: 0, y: 0, size: 10 },
      { kind: "area", x: 0, y: 0, size: 0 },
      { kind: "area", x: 0, y: 0, size: -10 },
      { kind: "area", x: Number.NaN, y: 0, size: 10 },
      { kind: "area", x: 0, y: 0 },
      { kind: "piece", file: "https://elsewhere.example/tile.avif" },
      { kind: "piece" },
    ]) {
      expect(parseBookmarkBadge(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("filterBookmarks", () => {
  it("matches on the name, ignoring case and surrounding spaces", () => {
    const list = make("Tower", make("Sky pile"));
    expect(filterBookmarks(list, "  SKY ").map((b) => b.name)).toEqual(["Sky pile"]);
  });

  it("gives the whole list back on an empty query", () => {
    const list = make("Tower", make("Sky pile"));
    expect(filterBookmarks(list, "  ")).toHaveLength(2);
  });
});

describe("parseBookmarks", () => {
  const entry = {
    id: "b1",
    name: "Sky pile",
    worldX: 12,
    worldY: 34,
    createdAt: 1_700_000_000_000,
    badge: BADGE,
  };
  const parsed = { ...entry, favorite: false };

  it("reads back what was written", () => {
    expect(parseBookmarks(JSON.stringify([entry]))).toEqual([parsed]);
  });

  it("leaves behind the zoom an older notebook stored", () => {
    expect(parseBookmarks(JSON.stringify([{ ...entry, zoom: 1.5 }]))).toEqual([parsed]);
  });

  it("reads a starred entry back starred, and anything but the flag as plain", () => {
    expect(parseBookmarks(JSON.stringify([{ ...entry, favorite: true }]))[0]!.favorite).toBe(true);
    expect(parseBookmarks(JSON.stringify([{ ...entry, favorite: "yes" }]))[0]!.favorite).toBe(
      false,
    );
  });

  it("opens a hand-edited file in the order the panel pages", () => {
    const stored = [
      { ...entry, id: "b1", createdAt: 300 },
      { ...entry, id: "b2", createdAt: 100, favorite: true },
    ];
    expect(parseBookmarks(JSON.stringify(stored)).map((b) => b.id)).toEqual(["b2", "b1"]);
  });

  it("returns an empty list for junk, a non-array, or nothing at all", () => {
    expect(parseBookmarks(null)).toEqual([]);
    expect(parseBookmarks("{oops")).toEqual([]);
    expect(parseBookmarks('{"id":"b1"}')).toEqual([]);
  });

  it("reads back a piece badge too", () => {
    const piece = { ...entry, badge: PIECE_BADGE };
    expect(parseBookmarks(JSON.stringify([piece]))).toEqual([{ ...piece, favorite: false }]);
  });

  it("drops an entry that is not a named, placed, badged point", () => {
    const broken = [
      { ...entry, id: "" },
      { ...entry, id: "b2", name: "   " },
      { ...entry, id: "b3", worldX: Number.NaN },
      { ...entry, id: "b4", worldY: "over there" },
      { ...entry, id: "b5", createdAt: "yesterday" },
      { ...entry, id: "b6", badge: { kind: "area", x: 0, y: 0, size: 0 } },
      { ...entry, id: "b7", badge: undefined },
    ];
    expect(parseBookmarks(JSON.stringify(broken))).toEqual([]);
  });

  it("keeps one entry per id", () => {
    expect(parseBookmarks(JSON.stringify([entry, { ...entry, name: "Twin" }]))).toHaveLength(1);
  });

  it("cuts the list at the cap", () => {
    const many = Array.from({ length: MAX_BOOKMARKS + 20 }, (_, i) => ({ ...entry, id: `b${i}` }));
    expect(parseBookmarks(JSON.stringify(many))).toHaveLength(MAX_BOOKMARKS);
  });
});

describe("serializeBookmarks", () => {
  it("survives a round trip, starred entries included", () => {
    const list = sortBookmarks([entry("kept", 300, true), entry("plain", 100)]);
    expect(parseBookmarks(serializeBookmarks(list))).toEqual(list);
  });

  it("writes no flag for a plain entry, which is most of the notebook", () => {
    expect(serializeBookmarks([entry("plain", 100)])).not.toContain("favorite");
    expect(serializeBookmarks([entry("kept", 100, true)])).toContain('"favorite":true');
  });
});
