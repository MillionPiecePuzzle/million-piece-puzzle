import { describe, it, expect } from "vitest";
import {
  BOOKMARK_NAME_MAX,
  MAX_BOOKMARKS,
  addBookmark,
  filterBookmarks,
  isBadgePath,
  normalizeBookmarkName,
  parseBookmarks,
  removeBookmark,
  type Bookmark,
} from "./bookmarks";

const BADGE = "source_files/12/3_4.webp";

function make(name: string, list: readonly Bookmark[] = []): Bookmark[] {
  return addBookmark(list, { name, worldX: 10, worldY: 20, zoom: 1, badge: BADGE });
}

describe("addBookmark", () => {
  it("puts the newest entry first", () => {
    const list = make("second", make("first"));
    expect(list.map((b) => b.name)).toEqual(["second", "first"]);
  });

  it("rounds the position to the world unit and the zoom to three decimals", () => {
    const [saved] = addBookmark([], {
      name: "spot",
      worldX: 1234.56,
      worldY: -78.9,
      zoom: 1.23456,
      badge: BADGE,
    });
    expect(saved).toMatchObject({ worldX: 1235, worldY: -79, zoom: 1.235 });
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
      zoom: 1,
      createdAt: 0,
      badge: BADGE,
    }));
    expect(make("one more", full)).toHaveLength(MAX_BOOKMARKS);
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

describe("isBadgePath", () => {
  it("takes a tile of the puzzle's own pyramid", () => {
    expect(isBadgePath(BADGE)).toBe(true);
    expect(isBadgePath("pieces/0123/012345.avif")).toBe(true);
  });

  it("refuses anything that is not a relative asset path", () => {
    for (const bad of [
      "https://elsewhere.example/tile.webp",
      "javascript:alert(1)",
      "/source_files/12/3_4.webp",
      "../../etc/passwd",
      "source_files/12/3_4",
      "",
      42,
      null,
    ]) {
      expect(isBadgePath(bad), String(bad)).toBe(false);
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
    zoom: 1.5,
    createdAt: 1_700_000_000_000,
    badge: BADGE,
  };

  it("reads back what was written", () => {
    expect(parseBookmarks(JSON.stringify([entry]))).toEqual([entry]);
  });

  it("returns an empty list for junk, a non-array, or nothing at all", () => {
    expect(parseBookmarks(null)).toEqual([]);
    expect(parseBookmarks("{oops")).toEqual([]);
    expect(parseBookmarks('{"id":"b1"}')).toEqual([]);
  });

  it("drops an entry that is not a named, framed, badged point", () => {
    const broken = [
      { ...entry, id: "" },
      { ...entry, id: "b2", name: "   " },
      { ...entry, id: "b3", worldX: Number.NaN },
      { ...entry, id: "b4", zoom: 0 },
      { ...entry, id: "b5", createdAt: "yesterday" },
      { ...entry, id: "b6", badge: "https://elsewhere.example/tile.webp" },
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
