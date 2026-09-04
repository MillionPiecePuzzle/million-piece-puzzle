import { describe, it, expect } from "vitest";
import {
  BOOKMARK_NAME_MAX,
  MAX_BOOKMARKS,
  MAX_TAGS,
  MAX_TAGS_PER_BOOKMARK,
  TAG_NAME_MAX,
  VIEW_ALL,
  VIEW_UNTAGGED,
  addBookmark,
  addTag,
  allTags,
  bookmarksInView,
  filterBookmarks,
  hasTag,
  isPieceFile,
  normalizeBookmarkName,
  normalizeTagName,
  parseBookmarkBadge,
  parseBookmarks,
  removeBookmark,
  removeTag,
  serializeBookmarks,
  sortBookmarks,
  tagView,
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
  it("lands a new entry where its name sorts", () => {
    const list = make("apple", make("cherry"));
    expect(list.map((b) => b.name)).toEqual(["apple", "cherry"]);
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
      tags: [],
    }));
    expect(make("one more", full)).toHaveLength(MAX_BOOKMARKS);
  });

  it("starts a new entry plain, favorites being what the player says afterwards", () => {
    const [saved] = make("spot");
    expect(saved!.favorite).toBe(false);
  });

  it("lands a new entry under the favorites whatever its name", () => {
    const kept = make("zebra");
    const starred = toggleBookmarkFavorite(kept, kept[0]!.id);
    const list = addBookmark(starred, { name: "apple", worldX: 0, worldY: 0, badge: BADGE });
    expect(list.map((b) => b.name)).toEqual(["zebra", "apple"]);
  });
});

// Built by hand, since what is under test is the order two entries come out in
// rather than the ids and the clock reading a real save mints.
function entry(name: string, favorite = false): Bookmark {
  return {
    id: name,
    name,
    worldX: 0,
    worldY: 0,
    createdAt: 1_700_000_000_000,
    badge: BADGE,
    favorite,
    tags: [],
  };
}

describe("sortBookmarks", () => {
  it("puts the favorites first and reads by name inside each block", () => {
    const list = sortBookmarks([
      entry("sky"),
      entry("zebra", true),
      entry("apple"),
      entry("cats", true),
    ]);
    expect(list.map((b) => b.name)).toEqual(["cats", "zebra", "apple", "sky"]);
  });

  it("sorts the way the player's own locale reads", () => {
    expect(
      sortBookmarks([entry("zebre"), entry("Été"), entry("arbre")]).map((b) => b.name),
    ).toEqual(["arbre", "Été", "zebre"]);
  });
});

describe("toggleBookmarkFavorite", () => {
  it("raises the starred entry to the top and drops it back when unstarred", () => {
    const list = [entry("apple"), entry("zebra")];
    const starred = toggleBookmarkFavorite(list, "zebra");
    expect(starred.map((b) => b.name)).toEqual(["zebra", "apple"]);
    expect(starred[0]!.favorite).toBe(true);
    expect(toggleBookmarkFavorite(starred, "zebra").map((b) => b.name)).toEqual(["apple", "zebra"]);
  });

  it("leaves the rest of the list alone", () => {
    const list = [entry("a"), entry("b")];
    expect(toggleBookmarkFavorite(list, "nobody")).toEqual(list);
  });
});

describe("removeBookmark", () => {
  it("drops the named entry and leaves the rest", () => {
    const list = make("b", make("a"));
    expect(removeBookmark(list, list[0]!.id).map((b) => b.name)).toEqual(["b"]);
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
  const parsed = { ...entry, favorite: false, tags: [] };

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
    expect(parseBookmarks(JSON.stringify([piece]))).toEqual([
      { ...piece, favorite: false, tags: [] },
    ]);
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
    const list = sortBookmarks([entry("kept", true), entry("plain")]);
    expect(parseBookmarks(serializeBookmarks(list))).toEqual(list);
  });

  it("writes no flag for a plain entry, which is most of the notebook", () => {
    expect(serializeBookmarks([entry("plain")])).not.toContain("favorite");
    expect(serializeBookmarks([entry("kept", true)])).toContain('"favorite":true');
  });

  it("writes no tags for an entry wearing none, and reads them back", () => {
    expect(serializeBookmarks([entry("plain")])).not.toContain("tags");
    const tagged = addTag([entry("tagged")], "tagged", "cats");
    expect(serializeBookmarks(tagged)).toContain('"tags":["cats"]');
    expect(parseBookmarks(serializeBookmarks(tagged))).toEqual(tagged);
  });
});

describe("tagging a bookmark", () => {
  const two = make("kitten", make("sky"));
  const first = two[0]!.id;

  it("carries the tag and keeps the list in one order", () => {
    const tagged = addTag(two, first, "cats");
    expect(tagged.find((b) => b.id === first)!.tags).toEqual(["cats"]);
    expect(tagged.map((b) => b.name)).toEqual(two.map((b) => b.name));
  });

  it("takes it back off", () => {
    const tagged = addTag(two, first, "cats");
    expect(removeTag(tagged, first, "CATS").find((b) => b.id === first)!.tags).toEqual([]);
  });

  it("never wears the same word twice, whatever its capitals", () => {
    const once = addTag(two, first, "Cats");
    expect(addTag(once, first, "cats").find((b) => b.id === first)!.tags).toEqual(["Cats"]);
  });

  it("joins the spelling the notebook already knows", () => {
    const known = addTag(two, first, "Cats");
    const second = addTag(known, two[1]!.id, "cats");
    expect(second[1]!.tags).toEqual(["Cats"]);
    expect(allTags(second)).toEqual(["Cats"]);
  });

  it("refuses a sixth rather than dropping one of the five", () => {
    let list = two;
    for (const name of ["a", "b", "c", "d", "e"]) list = addTag(list, first, name);
    expect(list.find((b) => b.id === first)!.tags).toHaveLength(MAX_TAGS_PER_BOOKMARK);
    expect(addTag(list, first, "f").find((b) => b.id === first)!.tags).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("keeps a bookmark's own tags alphabetical, which is how a row reads them", () => {
    const list = addTag(addTag(two, first, "sky"), first, "cats");
    expect(list.find((b) => b.id === first)!.tags).toEqual(["cats", "sky"]);
  });

  it("gives a new entry the tags it was written under", () => {
    const list = addBookmark([], { name: "spot", worldX: 0, worldY: 0, badge: BADGE }, ["cats"]);
    expect(list[0]!.tags).toEqual(["cats"]);
  });
});

describe("allTags", () => {
  it("is every word the notebook wears and nothing else, alphabetically", () => {
    let list = make("b", make("a"));
    list = addTag(list, list[0]!.id, "sky");
    list = addTag(list, list[1]!.id, "cats");
    expect(allTags(list)).toEqual(["cats", "sky"]);
  });

  it("loses a tag with the last bookmark wearing it", () => {
    let list = make("only");
    list = addTag(list, list[0]!.id, "cats");
    expect(allTags(removeTag(list, list[0]!.id, "cats"))).toEqual([]);
    expect(allTags(removeBookmark(list, list[0]!.id))).toEqual([]);
  });
});

describe("normalizeTagName", () => {
  it("trims, and refuses an empty name or one past the cap", () => {
    expect(normalizeTagName("  cats  ")).toBe("cats");
    expect(normalizeTagName("   ")).toBeNull();
    expect(normalizeTagName("x".repeat(TAG_NAME_MAX + 1))).toBeNull();
  });
});

describe("bookmarksInView", () => {
  let list = make("kitten", make("sky"));
  list = addTag(list, list[0]!.id, "cats");

  it("narrows to one tag, to the untagged block, or to nothing", () => {
    expect(bookmarksInView(list, VIEW_ALL)).toHaveLength(2);
    expect(bookmarksInView(list, tagView("cats")).map((b) => b.name)).toEqual(["kitten"]);
    expect(bookmarksInView(list, tagView("CATS")).map((b) => b.name)).toEqual(["kitten"]);
    expect(bookmarksInView(list, VIEW_UNTAGGED).map((b) => b.name)).toEqual(["sky"]);
    expect(bookmarksInView(list, tagView("nobody uses this"))).toEqual([]);
  });

  it("tells a tag from the two views that are not one, whatever it is called", () => {
    let named = make("all named all");
    named = addTag(named, named[0]!.id, VIEW_ALL);
    expect(bookmarksInView(named, VIEW_ALL)).toHaveLength(1);
    expect(bookmarksInView(named, tagView(VIEW_ALL))).toHaveLength(1);
    expect(bookmarksInView(named, VIEW_UNTAGGED)).toEqual([]);
  });
});

describe("parseBookmarks, tags", () => {
  const stored = {
    id: "b1",
    name: "Sky pile",
    worldX: 12,
    worldY: 34,
    createdAt: 1_700_000_000_000,
    badge: BADGE,
  };

  it("reads a tagged entry back tagged, in order", () => {
    expect(parseBookmarks(JSON.stringify([{ ...stored, tags: ["sky", "cats"] }]))[0]!.tags).toEqual(
      ["cats", "sky"],
    );
  });

  it("drops what is not a tag and keeps the entry that carried it", () => {
    const hand = [{ ...stored, tags: ["cats", 7, "", "   ", "x".repeat(200), "CATS"] }];
    expect(parseBookmarks(JSON.stringify(hand))[0]!.tags).toEqual(["cats"]);
  });

  it("reads a file that names no tags at all as untagged", () => {
    expect(parseBookmarks(JSON.stringify([stored]))[0]!.tags).toEqual([]);
    expect(parseBookmarks(JSON.stringify([{ ...stored, tags: "cats" }]))[0]!.tags).toEqual([]);
  });

  it("cuts an entry at five tags", () => {
    const many = [{ ...stored, tags: ["a", "b", "c", "d", "e", "f", "g"] }];
    expect(parseBookmarks(JSON.stringify(many))[0]!.tags).toHaveLength(MAX_TAGS_PER_BOOKMARK);
  });

  it("holds the notebook to its own bound on distinct tags", () => {
    const entries = Array.from({ length: MAX_TAGS / 2 + 10 }, (_, i) => ({
      ...stored,
      id: `b${i}`,
      tags: [`t${i * 2}`, `t${i * 2 + 1}`],
    }));
    const read = parseBookmarks(JSON.stringify(entries));
    expect(read).toHaveLength(entries.length);
    expect(allTags(read)).toHaveLength(MAX_TAGS);
  });

  it("gives one spelling to a word a hand-edited file wrote two ways", () => {
    const hand = [
      { ...stored, id: "b1", tags: ["Cats"] },
      { ...stored, id: "b2", tags: ["cats"] },
    ];
    expect(allTags(parseBookmarks(JSON.stringify(hand)))).toEqual(["Cats"]);
  });
});

describe("hasTag", () => {
  it("reads a word off a bookmark whatever its capitals", () => {
    const list = addTag(make("spot"), make("spot")[0]!.id, "cats");
    const [only] = addTag(make("spot"), "nobody", "cats");
    expect(hasTag(addTag(list, list[0]!.id, "Sky")[0]!, "sky")).toBe(true);
    expect(hasTag(only!, "cats")).toBe(false);
  });
});
