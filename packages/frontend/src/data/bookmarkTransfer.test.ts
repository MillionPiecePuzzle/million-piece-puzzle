import { describe, it, expect } from "vitest";
import type { PlayZone } from "@mpp/shared";
import type { BoardFrame } from "../canvas/boardCoords";
import { serializeBookmarks, type Bookmark } from "./bookmarks";
import {
  formatBookmarkCode,
  notebookFile,
  notebookFileName,
  parseBookmarkCode,
  parseNotebookFile,
  parseSharedBadge,
  sharedBadgeToBadge,
} from "./bookmarkTransfer";
import { sharedViewWorldPoint } from "./viewLink";

// The 1M board: 1000x1000 pieces of 120 source pixels, so the frame spans
// (0, 0) to (120000, 120000) in world space and the play zone runs well past it.
const board1m: BoardFrame = { cols: 1000, rows: 1000, pieceSize: 120 };
const zone: PlayZone = { minX: -210_000, minY: -210_000, maxX: 330_000, maxY: 330_000 };

// A bookmark on the 1M board: the square is centred on the point, so it travels
// as half its own width back from it. The scale is the sender's camera, since
// the entry itself holds none.
const bookmark: Bookmark = {
  id: "b1",
  name: "sky pile",
  worldX: 81_600,
  worldY: 120_000,
  createdAt: 1_700_000_000_000,
  badge: { x: 80_880, y: 119_280, size: 1440 },
  favorite: false,
  tags: [],
};
const senderZoom = 0.85;

describe("formatBookmarkCode", () => {
  it("carries the spot, the square in pieces from it, the name and the words", () => {
    const filed = { ...bookmark, tags: ["sky", "still to place"] };
    const code = formatBookmarkCode(filed, board1m, senderZoom);
    expect(code).toBe("mppb1:180,500,0.85:-6,-6,12:sky%20pile:sky,still%20to%20place");
    expect(code.length).toBeLessThan(100);
  });

  it("carries an empty name for an entry its sender named nothing", () => {
    const filed = { ...bookmark, name: "", tags: ["cats"] };
    expect(formatBookmarkCode(filed, board1m, senderZoom)).toBe(
      "mppb1:180,500,0.85:-6,-6,12::cats",
    );
  });

  it("carries no emblem for a spot off the picture, which wears none", () => {
    const bare = { ...bookmark, badge: null };
    expect(formatBookmarkCode(bare, board1m, senderZoom)).toBe("mppb1:180,500,0.85::sky%20pile:");
  });

  it("hands over the scale the sender is reading the board at", () => {
    const code = formatBookmarkCode(bookmark, board1m, 2.5);
    expect(parseBookmarkCode(code)?.view.zoom).toBe(2.5);
  });

  it("encodes a name or a word holding a separator rather than breaking on it", () => {
    const awkward = { ...bookmark, name: "sky: the pile, left", tags: ["a:b", "c,d"] };
    const parsed = parseBookmarkCode(formatBookmarkCode(awkward, board1m, senderZoom));
    expect(parsed?.name).toBe("sky: the pile, left");
    expect(parsed?.tags).toEqual(["a:b", "c,d"]);
  });

  it("stays a pasteable line for the longest name and the fullest set of words", () => {
    const full = {
      ...bookmark,
      name: "pile de ciel à gauche de la tour, en bas",
      tags: ["ciel", "à trier", "tour", "bord", "plus tard"],
    };
    expect(formatBookmarkCode(full, board1m, senderZoom).length).toBeLessThan(200);
  });

  it("leaves the id and the star behind, since neither is about the spot", () => {
    const starred = { ...bookmark, id: "bmf2k7z", favorite: true };
    const code = formatBookmarkCode(starred, board1m, senderZoom);
    expect(code).not.toContain(starred.id);
    expect(code).toBe(formatBookmarkCode(bookmark, board1m, senderZoom));
  });
});

describe("parseBookmarkCode", () => {
  const code = "mppb1:180,500,0.85:-6,-6,12:sky%20pile:sky,later";
  const parsed = {
    view: { x: 180, y: 500, zoom: 0.85 },
    name: "sky pile",
    badge: { dx: -6, dy: -6, size: 12 },
    tags: ["sky", "later"],
  };

  it("reads back the draft a code carries", () => {
    expect(parseBookmarkCode(code)).toEqual(parsed);
    expect(parseBookmarkCode(`  ${code}  `)).toEqual(parsed);
  });

  it("reads an empty name as the draft of an entry its sender named nothing", () => {
    expect(parseBookmarkCode("mppb1:180,500,0.85:-6,-6,12::cats")?.name).toBe("");
  });

  it("reads a code with no emblem as a whole bookmark, wearing none", () => {
    expect(parseBookmarkCode("mppb1:180,500,0.85::sky%20pile:")).toEqual({
      ...parsed,
      badge: null,
      tags: [],
    });
  });

  it("trims and caps the name like one the player typed", () => {
    expect(parseBookmarkCode("mppb1:180,500,0.85::%20%20sky%20pile%20%20:")?.name).toBe("sky pile");
    expect(parseBookmarkCode(`mppb1:180,500,0.85::${"x".repeat(41)}:`)).toBeNull();
  });

  it("drops a word that is no word rather than the bookmark it rode in on", () => {
    expect(parseBookmarkCode("mppb1:180,500,0.85:::sky,,%20,later")?.tags).toEqual([
      "sky",
      "later",
    ]);
    expect(parseBookmarkCode(`mppb1:180,500,0.85:::sky,${"x".repeat(25)}`)?.tags).toEqual(["sky"]);
    expect(parseBookmarkCode("mppb1:180,500,0.85:::sky,Sky")?.tags).toEqual(["sky"]);
    expect(parseBookmarkCode("mppb1:180,500,0.85:::a,b,c,d,e,f")?.tags).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("refuses a line that is not a shared bookmark", () => {
    expect(parseBookmarkCode("https://example.org/play?at=180,500,0.85")).toBeNull();
    expect(parseBookmarkCode("have a look at this")).toBeNull();
    expect(parseBookmarkCode("   ")).toBeNull();
    expect(parseBookmarkCode("mppb2:180,500,0.85:-6,-6,12:sky%20pile:")).toBeNull();
  });

  it("refuses a truncated or overlong code rather than half-applying it", () => {
    expect(parseBookmarkCode("mppb1:180,500,0.85:-6,-6,12:sky%20pile")).toBeNull();
    expect(parseBookmarkCode("mppb1:180,500,0.85:-6,-6,12:sky%20pile::")).toBeNull();
    expect(parseBookmarkCode("mppb1:180,500:-6,-6,12:sky%20pile:")).toBeNull();
    expect(parseBookmarkCode("mppb1:0,0,NaN:::")).toBeNull();
  });

  it("refuses an emblem that reads as no square the panel would trace", () => {
    expect(parseBookmarkCode("mppb1:180,500,0.85:-6,-6,99:sky%20pile:")).toBeNull();
    expect(parseBookmarkCode("mppb1:180,500,0.85:-6,-6:sky%20pile:")).toBeNull();
  });

  it("refuses a percent sign a chat client mangled rather than reading past it", () => {
    expect(parseBookmarkCode("mppb1:180,500,0.85::sky%2:")).toBeNull();
  });
});

describe("parseSharedBadge", () => {
  it("reads back the square", () => {
    expect(parseSharedBadge("-6,-6,12")).toEqual({ dx: -6, dy: -6, size: 12 });
  });

  it("refuses a square no panel would have traced", () => {
    expect(parseSharedBadge("-6,-6,3")).toBeNull();
    expect(parseSharedBadge("-6,-6,25")).toBeNull();
    expect(parseSharedBadge("-6,-6,1e9")).toBeNull();
    expect(parseSharedBadge("-6,-6,0")).toBeNull();
  });

  it("refuses a badge that is not three numbers", () => {
    expect(parseSharedBadge("-6,-6")).toBeNull();
    expect(parseSharedBadge("-6,-6,12,4")).toBeNull();
    expect(parseSharedBadge("sky,pile,12")).toBeNull();
    expect(parseSharedBadge("")).toBeNull();
    expect(parseSharedBadge(null)).toBeNull();
  });
});

describe("sharedBadgeToBadge", () => {
  it("puts the square back where it was, in the recipient's world units", () => {
    const point = { x: 81_600, y: 120_000 };
    expect(sharedBadgeToBadge({ dx: -6, dy: -6, size: 12 }, point, board1m)).toEqual(
      bookmark.badge,
    );
  });

  it("survives a round trip through the code", () => {
    const shared = parseBookmarkCode(formatBookmarkCode(bookmark, board1m, senderZoom))!;
    const point = sharedViewWorldPoint(shared.view, board1m, zone);
    expect(point).toEqual({ x: bookmark.worldX, y: bookmark.worldY });
    expect(shared.name).toBe(bookmark.name);
    expect(sharedBadgeToBadge(shared.badge, point, board1m)).toEqual(bookmark.badge);
  });

  it("lands on the same picture on a board sliced at another piece size", () => {
    const smaller: BoardFrame = { cols: 1000, rows: 1000, pieceSize: 72 };
    expect(sharedBadgeToBadge({ dx: -6, dy: -6, size: 12 }, { x: 0, y: 0 }, smaller)).toEqual({
      x: -432,
      y: -432,
      size: 864,
    });
  });
});

describe("notebookFile", () => {
  const list: Bookmark[] = [
    { ...bookmark, favorite: true, tags: ["sky", "later"] },
    { ...bookmark, id: "b2", name: "", worldX: 0, worldY: 0, badge: null, tags: ["cats"] },
  ];
  const at = new Date(Date.UTC(2026, 8, 6, 9, 30));

  it("carries every entry whole, its star and its words included", () => {
    const read = parseNotebookFile(notebookFile("earth-mosaic", list, at), "earth-mosaic");
    expect(read).toEqual({ kind: "ok", bookmarks: list });
  });

  it("names the board it was written for and the day it was written", () => {
    const file = JSON.parse(notebookFile("earth-mosaic", list, at)) as Record<string, unknown>;
    expect(file.kind).toBe("mpp.bookmarks");
    expect(file.version).toBe(1);
    expect(file.puzzleId).toBe("earth-mosaic");
    expect(file.at).toBe("2026-09-06T09:30:00.000Z");
  });

  it("says which board a notebook from another one was written for", () => {
    const read = parseNotebookFile(notebookFile("earth-mosaic", list, at), "synthetic-1m");
    expect(read).toEqual({ kind: "other-board", puzzleId: "earth-mosaic" });
  });

  it("refuses a file that is not a notebook", () => {
    expect(parseNotebookFile("", "earth-mosaic").kind).toBe("bad");
    expect(parseNotebookFile("not json at all", "earth-mosaic").kind).toBe("bad");
    expect(parseNotebookFile(serializeBookmarks(list), "earth-mosaic").kind).toBe("bad");
    expect(parseNotebookFile('{"kind":"mpp.bookmarks"}', "earth-mosaic").kind).toBe("bad");
    expect(parseNotebookFile('{"kind":"mpp.bookmarks","version":2,"puzzleId":"x"}', "x").kind).toBe(
      "bad",
    );
  });

  it("reads a hand-edited file the way the origin's own storage is read", () => {
    const raw = JSON.stringify({
      kind: "mpp.bookmarks",
      version: 1,
      puzzleId: "earth-mosaic",
      bookmarks: [
        { id: "b1", worldX: 10, worldY: 20, createdAt: 1, name: "kept" },
        { id: "b2", worldX: "nowhere", worldY: 20, createdAt: 1 },
        "not an entry",
      ],
    });
    const read = parseNotebookFile(raw, "earth-mosaic");
    expect(read.kind === "ok" && read.bookmarks.map((b) => b.name)).toEqual(["kept"]);
  });
});

describe("notebookFileName", () => {
  it("names the board and the day", () => {
    expect(notebookFileName("earth-mosaic", new Date(2026, 8, 6))).toBe(
      "bookmarks-earth-mosaic-2026-09-06.json",
    );
  });

  it("keeps a puzzle id fit for a file name", () => {
    expect(notebookFileName("Earth Mosaic (v2)", new Date(2026, 8, 6))).toBe(
      "bookmarks-earth-mosaic-v2-2026-09-06.json",
    );
  });
});
