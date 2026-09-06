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
  badgeAround,
  bookmarkLabel,
  bookmarksInView,
  dropGoneTags,
  filterBookmarks,
  hasAnyTag,
  hasSameBookmark,
  mergeBookmarks,
  normalizeBookmarkName,
  normalizeTagName,
  parseBookmarkBadge,
  parseBookmarks,
  removeBookmark,
  removeTag,
  renameBookmark,
  serializeBookmarks,
  sortBookmarks,
  tagView,
  toggleBookmarkFavorite,
  withTag,
  withoutTag,
  type Bookmark,
  type BookmarkBadge,
} from "./bookmarks";

const BADGE: BookmarkBadge = { x: 1200, y: 2400, size: 1440 };

function parseStored(raw: string | null): Bookmark[] {
  return parseBookmarks(raw);
}

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

  it("rounds the badge square to the world unit", () => {
    const [square] = addBookmark([], {
      name: "spot",
      worldX: 0,
      worldY: 0,
      badge: { x: 11.4, y: -22.6, size: 1440.2 },
    });
    expect(square!.badge).toEqual({ x: 11, y: -23, size: 1440 });
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

  it("refuses an entry the notebook already holds to the word", () => {
    expect(make("apple", make("apple"))).toHaveLength(1);
  });

  it("refuses the twin of a starred entry, the star being no part of the entry", () => {
    const kept = make("apple");
    const starred = toggleBookmarkFavorite(kept, kept[0]!.id);
    expect(make("apple", starred)).toHaveLength(1);
  });

  it("keeps the same place under another name", () => {
    expect(make("apple", make("cherry"))).toHaveLength(2);
  });

  it("keeps the same place filed under another word", () => {
    const spot = { name: "apple", worldX: 10, worldY: 20, badge: BADGE };
    expect(addBookmark(addBookmark([], spot, ["cats"]), spot, ["dogs"])).toHaveLength(2);
  });

  it("reads a word back as the one it already knows, so its capitals are no second entry", () => {
    const spot = { name: "apple", worldX: 10, worldY: 20, badge: BADGE };
    expect(addBookmark(addBookmark([], spot, ["Cats"]), spot, ["cats"])).toHaveLength(1);
  });
});

describe("hasSameBookmark", () => {
  it("answers for the entry the notebook holds, and not for its neighbours", () => {
    const kept = make("apple");
    const spot = { name: "apple", worldX: 10, worldY: 20, badge: BADGE };
    expect(hasSameBookmark(kept, spot)).toBe(true);
    expect(hasSameBookmark(kept, { ...spot, name: "cherry" })).toBe(false);
    expect(hasSameBookmark(kept, { ...spot, worldX: 11 })).toBe(false);
    expect(hasSameBookmark(kept, { ...spot, badge: null })).toBe(false);
  });

  it("keys the place as it is stored, so a fraction of a world unit is the same spot", () => {
    expect(
      hasSameBookmark(make("apple"), { name: "apple", worldX: 10.4, worldY: 20, badge: BADGE }),
    ).toBe(true);
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

// An entry the player never named, which reads under the first word it is filed
// under and under nothing at all when it wears none.
function unnamed(id: string, tags: string[] = []): Bookmark {
  return { ...entry(""), id, tags };
}

describe("bookmarkLabel", () => {
  it("is the player's own name where they wrote one, tags or no tags", () => {
    expect(bookmarkLabel(entry("sky pile"))).toBe("sky pile");
    expect(bookmarkLabel({ ...entry("sky pile"), tags: ["cats"] })).toBe("sky pile");
  });

  it("takes the word the moment the entry is filed under it", () => {
    expect(bookmarkLabel(addTag([unnamed("b1")], "b1", "Cat")[0]!)).toBe("Cat");
  });

  it("falls to the next word when that one is taken back off", () => {
    const filed = addTag(addTag([unnamed("b1")], "b1", "Cat"), "b1", "Sky");
    expect(bookmarkLabel(removeTag(filed, "b1", "cat")[0]!)).toBe("Sky");
  });

  it("is empty where there is neither, the stand-in being the panel's own word", () => {
    expect(bookmarkLabel(unnamed("b1"))).toBe("");
  });
});

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

  it("reads an unnamed entry by its first word, and one wearing none at the top", () => {
    const list = sortBookmarks([entry("apple"), unnamed("b1", ["sky"]), unnamed("b2")]);
    expect(list.map((b) => b.id)).toEqual(["b2", "apple", "b1"]);
  });
});

describe("renameBookmark", () => {
  it("writes the name and re-sorts the notebook around it", () => {
    const list = sortBookmarks([entry("apple"), entry("sky")]);
    expect(renameBookmark(list, "sky", "ant").map((b) => b.name)).toEqual(["ant", "apple"]);
  });

  it("hands an entry cleared of its name back to the word it is filed under", () => {
    const list = [{ ...entry("sky pile"), tags: ["cats"] }];
    expect(bookmarkLabel(renameBookmark(list, "sky pile", "")[0]!)).toBe("cats");
  });

  it("leaves the rest of the list alone", () => {
    const list = sortBookmarks([entry("a"), entry("b")]);
    expect(renameBookmark(list, "nobody", "c")).toEqual(list);
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

  it("reads a blank name as no name, which an entry is allowed to have", () => {
    expect(normalizeBookmarkName("   ")).toBe("");
  });

  it("refuses a name past the cap", () => {
    expect(normalizeBookmarkName("x".repeat(BOOKMARK_NAME_MAX + 1))).toBeNull();
  });
});

describe("parseBookmarkBadge", () => {
  it("reads back the square", () => {
    expect(parseBookmarkBadge({ ...BADGE })).toEqual(BADGE);
  });

  it("keeps nothing an entry carries beyond the badge itself", () => {
    expect(parseBookmarkBadge({ kind: "area", ...BADGE, onload: "alert(1)" })).toEqual(BADGE);
  });

  it("refuses a badge that is not a drawable square", () => {
    for (const bad of [
      null,
      "pieces/0123/012345.avif",
      { kind: "piece", file: "pieces/0123/012345.avif" },
      { x: 0, y: 0, size: 0 },
      { x: 0, y: 0, size: -10 },
      { x: Number.NaN, y: 0, size: 10 },
      { x: 0, y: 0 },
    ]) {
      expect(parseBookmarkBadge(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("badgeAround", () => {
  it("traces the square around the point it is given", () => {
    expect(badgeAround(1000, 2000, 480)).toEqual({ x: 760, y: 1760, size: 480 });
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

  it("matches an unnamed entry on the word it reads under", () => {
    expect(filterBookmarks([unnamed("b1", ["cats"])], "CAT").map((b) => b.id)).toEqual(["b1"]);
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
    expect(parseStored(JSON.stringify([entry]))).toEqual([parsed]);
  });

  it("leaves behind the zoom an older notebook stored", () => {
    expect(parseStored(JSON.stringify([{ ...entry, zoom: 1.5 }]))).toEqual([parsed]);
  });

  it("reads a starred entry back starred, and anything but the flag as plain", () => {
    expect(parseStored(JSON.stringify([{ ...entry, favorite: true }]))[0]!.favorite).toBe(true);
    expect(parseStored(JSON.stringify([{ ...entry, favorite: "yes" }]))[0]!.favorite).toBe(false);
  });

  it("opens a hand-edited file in the order the panel pages", () => {
    const stored = [
      { ...entry, id: "b1", createdAt: 300 },
      { ...entry, id: "b2", createdAt: 100, favorite: true },
    ];
    expect(parseStored(JSON.stringify(stored)).map((b) => b.id)).toEqual(["b2", "b1"]);
  });

  it("returns an empty list for junk, a non-array, or nothing at all", () => {
    expect(parseStored(null)).toEqual([]);
    expect(parseStored("{oops")).toEqual([]);
    expect(parseStored('{"id":"b1"}')).toEqual([]);
  });

  // A notebook written when a bookmark could stand for one loose piece, which is
  // a badge no square can be read out of: the point is what the entry is for, so
  // the row keeps it and reads under the default badge.
  it("keeps an entry whose badge is no square, wearing none", () => {
    const stored = [
      { ...entry, id: "b1", badge: { kind: "piece", file: "pieces/0123/012345.avif" } },
      { ...entry, id: "b2", badge: undefined },
      { ...entry, id: "b3", badge: { x: 0, y: 0, size: 0 } },
    ];
    const read = parseStored(JSON.stringify(stored));
    expect(read.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    expect(read.map((b) => b.badge)).toEqual([null, null, null]);
  });

  it("drops an entry that is not a placed point", () => {
    const broken = [
      { ...entry, id: "" },
      { ...entry, id: "b2", name: "x".repeat(BOOKMARK_NAME_MAX + 1) },
      { ...entry, id: "b3", worldX: Number.NaN },
      { ...entry, id: "b4", worldY: "over there" },
      { ...entry, id: "b5", createdAt: "yesterday" },
      { ...entry, id: "b8", name: 12 },
    ];
    expect(parseStored(JSON.stringify(broken))).toEqual([]);
  });

  it("keeps an entry that names no name, which is one the player never named", () => {
    const stored = [
      { ...entry, name: "   " },
      { ...entry, id: "b2", name: undefined },
    ];
    expect(parseStored(JSON.stringify(stored)).map((b) => b.name)).toEqual(["", ""]);
  });

  it("keeps one entry per id", () => {
    expect(parseStored(JSON.stringify([entry, { ...entry, name: "Twin" }]))).toHaveLength(1);
  });

  it("cuts the list at the cap", () => {
    const many = Array.from({ length: MAX_BOOKMARKS + 20 }, (_, i) => ({ ...entry, id: `b${i}` }));
    expect(parseStored(JSON.stringify(many))).toHaveLength(MAX_BOOKMARKS);
  });
});

describe("serializeBookmarks", () => {
  it("survives a round trip, starred entries included", () => {
    const list = sortBookmarks([entry("kept", true), entry("plain")]);
    expect(parseStored(serializeBookmarks(list))).toEqual(list);
  });

  it("writes no flag for a plain entry, which is most of the notebook", () => {
    expect(serializeBookmarks([entry("plain")])).not.toContain("favorite");
    expect(serializeBookmarks([entry("kept", true)])).toContain('"favorite":true');
  });

  it("writes no name for an entry that was never named, and reads it back unnamed", () => {
    const list = [unnamed("b1", ["cats"])];
    expect(serializeBookmarks(list)).not.toContain('"name"');
    expect(parseStored(serializeBookmarks(list))).toEqual(list);
  });

  it("writes no tags for an entry wearing none, and reads them back", () => {
    expect(serializeBookmarks([entry("plain")])).not.toContain("tags");
    const tagged = addTag([entry("tagged")], "tagged", "cats");
    expect(serializeBookmarks(tagged)).toContain('"tags":["cats"]');
    expect(parseStored(serializeBookmarks(tagged))).toEqual(tagged);
  });

  it("writes no badge for a spot off the picture, and reads it back wearing none", () => {
    const bare = [{ ...entry("bare ground"), badge: null }];
    expect(serializeBookmarks(bare)).not.toContain("badge");
    expect(parseStored(serializeBookmarks(bare))).toEqual(bare);
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

  it("keeps a bookmark's own tags in the order they were put on it", () => {
    const list = addTag(addTag(two, first, "sky"), first, "cats");
    expect(list.find((b) => b.id === first)!.tags).toEqual(["sky", "cats"]);
  });

  it("moves an unnamed entry to where the word it now reads under sorts", () => {
    const list = sortBookmarks([entry("apple"), unnamed("b1")]);
    expect(addTag(list, "b1", "zebra").map((b) => b.id)).toEqual(["apple", "b1"]);
  });

  it("gives a new entry the tags it was written under", () => {
    const list = addBookmark([], { name: "spot", worldX: 0, worldY: 0, badge: BADGE }, ["cats"]);
    expect(list[0]!.tags).toEqual(["cats"]);
  });
});

// The same rule the picker writes an entry being created through, where there is
// no bookmark to hold the words yet.
describe("tagging an entry being written", () => {
  it("keeps the words in the order they were written", () => {
    expect(withTag(withTag([], "sky"), "cats")).toEqual(["sky", "cats"]);
  });

  it("never wears the same word twice, whatever its capitals", () => {
    expect(withTag(["Cats"], "cats")).toEqual(["Cats"]);
  });

  it("refuses a sixth rather than dropping one of the five", () => {
    const five = ["a", "b", "c", "d", "e"];
    expect(five).toHaveLength(MAX_TAGS_PER_BOOKMARK);
    expect(withTag(five, "f")).toEqual(five);
  });

  it("takes a word back off whatever its capitals", () => {
    expect(withoutTag(["cats", "sky"], "CATS")).toEqual(["sky"]);
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
  const base = make("cloud", make("kitten", make("sky")));
  const kitten = base.find((b) => b.name === "kitten")!.id;
  const sky = base.find((b) => b.name === "sky")!.id;
  const list = addTag(addTag(addTag(base, kitten, "cats"), kitten, "soft"), sky, "soft");

  it("narrows to one word, to the untagged block, or to nothing", () => {
    expect(bookmarksInView(list, [])).toHaveLength(3);
    expect(bookmarksInView(list, [tagView("cats")]).map((b) => b.name)).toEqual(["kitten"]);
    expect(bookmarksInView(list, [tagView("CATS")]).map((b) => b.name)).toEqual(["kitten"]);
    expect(bookmarksInView(list, [VIEW_UNTAGGED]).map((b) => b.name)).toEqual(["cloud"]);
    expect(bookmarksInView(list, [tagView("nobody uses this")])).toEqual([]);
  });

  it("keeps the bookmarks wearing every word of the reading, not any of them", () => {
    expect(bookmarksInView(list, [tagView("soft")]).map((b) => b.name)).toEqual(["kitten", "sky"]);
    expect(bookmarksInView(list, [tagView("soft"), tagView("cats")]).map((b) => b.name)).toEqual([
      "kitten",
    ]);
    expect(bookmarksInView(list, [tagView("soft"), VIEW_UNTAGGED])).toEqual([]);
  });

  it("tells a tag from the two readings that are not one, whatever it is called", () => {
    let named = make("all named all");
    named = addTag(named, named[0]!.id, VIEW_ALL);
    expect(bookmarksInView(named, [])).toHaveLength(1);
    expect(bookmarksInView(named, [tagView(VIEW_ALL)])).toHaveLength(1);
    expect(bookmarksInView(named, [VIEW_UNTAGGED])).toEqual([]);
  });
});

describe("dropGoneTags", () => {
  it("takes out the words the notebook lost and leaves the rest of the reading", () => {
    const view = [tagView("cats"), VIEW_UNTAGGED, tagView("sky")];
    expect(dropGoneTags(view, ["Cats"])).toEqual([tagView("cats"), VIEW_UNTAGGED]);
    expect(dropGoneTags(view, [])).toEqual([VIEW_UNTAGGED]);
    expect(dropGoneTags([], ["cats"])).toEqual([]);
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

  it("reads a tagged entry back tagged, in the order it was written", () => {
    expect(parseStored(JSON.stringify([{ ...stored, tags: ["sky", "cats"] }]))[0]!.tags).toEqual([
      "sky",
      "cats",
    ]);
  });

  it("drops what is not a tag and keeps the entry that carried it", () => {
    const hand = [{ ...stored, tags: ["cats", 7, "", "   ", "x".repeat(200), "CATS"] }];
    expect(parseStored(JSON.stringify(hand))[0]!.tags).toEqual(["cats"]);
  });

  it("reads a file that names no tags at all as untagged", () => {
    expect(parseStored(JSON.stringify([stored]))[0]!.tags).toEqual([]);
    expect(parseStored(JSON.stringify([{ ...stored, tags: "cats" }]))[0]!.tags).toEqual([]);
  });

  it("cuts an entry at five tags", () => {
    const many = [{ ...stored, tags: ["a", "b", "c", "d", "e", "f", "g"] }];
    expect(parseStored(JSON.stringify(many))[0]!.tags).toHaveLength(MAX_TAGS_PER_BOOKMARK);
  });

  it("holds the notebook to its own bound on distinct tags", () => {
    const entries = Array.from({ length: MAX_TAGS / 2 + 10 }, (_, i) => ({
      ...stored,
      id: `b${i}`,
      tags: [`t${i * 2}`, `t${i * 2 + 1}`],
    }));
    const read = parseStored(JSON.stringify(entries));
    expect(read).toHaveLength(entries.length);
    expect(allTags(read)).toHaveLength(MAX_TAGS);
  });

  it("gives one spelling to a word a hand-edited file wrote two ways", () => {
    const hand = [
      { ...stored, id: "b1", tags: ["Cats"] },
      { ...stored, id: "b2", tags: ["cats"] },
    ];
    expect(allTags(parseStored(JSON.stringify(hand)))).toEqual(["Cats"]);
  });
});

describe("hasAnyTag", () => {
  it("reads a word off a bookmark whatever its capitals", () => {
    const list = addTag(make("spot"), make("spot")[0]!.id, "cats");
    const [only] = addTag(make("spot"), "nobody", "cats");
    expect(hasAnyTag(addTag(list, list[0]!.id, "Sky")[0]!.tags, "sky")).toBe(true);
    expect(hasAnyTag(only!.tags, "cats")).toBe(false);
  });
});

// A notebook read off a file, poured into the one this browser keeps.
function fileEntry(name: string, worldX: number, over: Partial<Bookmark> = {}): Bookmark {
  return {
    id: `f-${name}`,
    name,
    worldX,
    worldY: 20,
    createdAt: 1_700_000_000_000,
    badge: BADGE,
    favorite: false,
    tags: [],
    ...over,
  };
}

describe("mergeBookmarks", () => {
  it("keeps what the notebook holds and adds what the file carries", () => {
    const kept = make("cherry");
    const { list, added } = mergeBookmarks(kept, [fileEntry("apple", 100)]);
    expect(list.map((b) => b.name)).toEqual(["apple", "cherry"]);
    expect(added).toBe(1);
  });

  it("carries a star and an age over, since the file is the player's own notebook", () => {
    const starred = fileEntry("apple", 100, { favorite: true, createdAt: 42 });
    const [first] = mergeBookmarks([], [starred]).list;
    expect(first).toMatchObject({ favorite: true, createdAt: 42 });
  });

  it("writes a spot already kept only once, so the same file twice adds nothing", () => {
    const once = mergeBookmarks([], [fileEntry("apple", 100)]).list;
    const twice = mergeBookmarks(once, [fileEntry("apple", 100)]);
    expect(twice.list).toHaveLength(1);
    expect(twice.added).toBe(0);
  });

  it("keeps two entries of one name at two places, which are two spots", () => {
    const { list } = mergeBookmarks([], [fileEntry("apple", 100), fileEntry("apple", 200)]);
    expect(list).toHaveLength(2);
  });

  it("writes an entry of that place filed under another word, which is not the one kept", () => {
    const kept = mergeBookmarks([], [fileEntry("apple", 100)]).list;
    const { list } = mergeBookmarks(kept, [fileEntry("apple", 100, { tags: ["cats"] })]);
    expect(list).toHaveLength(2);
  });

  it("mints an id for one colliding with an entry already kept", () => {
    const kept = mergeBookmarks([], [fileEntry("apple", 100)]).list;
    const { list } = mergeBookmarks(kept, [fileEntry("banana", 200, { id: kept[0]!.id })]);
    expect(new Set(list.map((b) => b.id)).size).toBe(2);
  });

  it("gives an incoming word the spelling the notebook already knows", () => {
    const cherry = make("cherry");
    const kept = addTag(cherry, cherry[0]!.id, "Cats");
    const { list } = mergeBookmarks(kept, [fileEntry("apple", 100, { tags: ["cats"] })]);
    expect(allTags(list)).toEqual(["Cats"]);
  });

  it("refuses to grow past the cap", () => {
    const full = Array.from({ length: MAX_BOOKMARKS }, (_, i) => fileEntry(`spot ${i}`, i));
    const { list, added } = mergeBookmarks(full, [fileEntry("one more", -1)]);
    expect(list).toHaveLength(MAX_BOOKMARKS);
    expect(added).toBe(0);
  });

  it("comes out in the one order the notebook is read in", () => {
    const { list } = mergeBookmarks(make("cherry"), [
      fileEntry("zebra", 100, { favorite: true }),
      fileEntry("apple", 200),
    ]);
    expect(list.map((b) => b.name)).toEqual(["zebra", "apple", "cherry"]);
  });
});
