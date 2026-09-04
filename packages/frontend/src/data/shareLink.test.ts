import { describe, it, expect } from "vitest";
import type { PlayZone } from "@mpp/shared";
import type { BoardFrame } from "../canvas/boardCoords";
import type { Bookmark } from "./bookmarks";
import {
  bookmarkShareUrl,
  formatSharedView,
  parseShareLink,
  parseSharedBadge,
  parseSharedBookmark,
  parseSharedView,
  shareUrl,
  sharedBadgeToBadge,
  sharedViewWorldPoint,
} from "./shareLink";

// The 1M board: 1000x1000 pieces of 120 source pixels, so the frame spans
// (0, 0) to (120000, 120000) in world space and the play zone runs well past it.
const board1m: BoardFrame = { cols: 1000, rows: 1000, pieceSize: 120 };
const zone: PlayZone = { minX: -210_000, minY: -210_000, maxX: 330_000, maxY: 330_000 };

describe("formatSharedView", () => {
  it("keeps a tenth of a piece and three decimals of zoom", () => {
    expect(formatSharedView({ x: -123.46, y: 88.04, zoom: 0.3125 })).toBe("-123.5,88,0.313");
  });

  it("drops trailing zeros, so a whole coordinate costs no decimal point", () => {
    expect(formatSharedView({ x: 0, y: -500, zoom: 1 })).toBe("0,-500,1");
  });

  it("never writes a minus zero", () => {
    expect(formatSharedView({ x: -0.02, y: 0, zoom: 1 })).toBe("0,0,1");
  });
});

describe("shareUrl", () => {
  it("names the play route and carries the whole framing in one parameter", () => {
    expect(shareUrl("https://example.org", { x: 180, y: 250, zoom: 0.31 }, null)).toBe(
      "https://example.org/play?at=180,250,0.31",
    );
  });
});

// A bookmark on the 1M board: the square is centred on the point, so it travels
// as half its own width back from it. The scale is the sender's camera, since
// the entry itself holds none.
const bookmark: Bookmark = {
  id: "b1",
  name: "sky pile",
  worldX: 81_600,
  worldY: 120_000,
  createdAt: 1_700_000_000_000,
  badge: { kind: "area", x: 80_880, y: 119_280, size: 1440 },
  favorite: false,
  tags: [],
};
const senderZoom = 0.85;

describe("bookmarkShareUrl", () => {
  it("carries the spot, the square in pieces from it, and the name in one line", () => {
    const url = bookmarkShareUrl("https://example.org", bookmark, board1m, senderZoom);
    expect(url).toBe("https://example.org/play?at=180,500,0.85&b=-6,-6,12&n=sky%20pile");
    expect(url.length).toBeLessThan(100);
  });

  it("hands over the scale the sender is reading the board at", () => {
    const url = bookmarkShareUrl("https://example.org", bookmark, board1m, 2.5);
    expect(parseSharedView(new URL(url).searchParams.get("at"))?.zoom).toBe(2.5);
  });

  it("stays a pasteable line for the longest name the panel takes", () => {
    const name = "pile de ciel à gauche de la tour, en haut";
    const url = bookmarkShareUrl(
      "https://millionpiecepuzzle.com",
      { ...bookmark, name },
      board1m,
      senderZoom,
    );
    expect(url.length).toBeLessThan(140);
  });

  it("hands a piece emblem over as the piece's own tile, unencoded", () => {
    const badge = { kind: "piece", file: "pieces/0123/012345.avif" } as const;
    expect(
      bookmarkShareUrl("https://example.org", { ...bookmark, badge }, board1m, senderZoom),
    ).toBe("https://example.org/play?at=180,500,0.85&b=pieces/0123/012345.avif&n=sky%20pile");
  });
});

describe("parseShareLink", () => {
  const link = "https://example.org/play?at=180,500,0.85&b=-6,-6,12&n=sky%20pile";
  const parsed = {
    view: { x: 180, y: 500, zoom: 0.85 },
    bookmark: { name: "sky pile", badge: { dx: -6, dy: -6, size: 12 } },
  };

  it("reads a whole pasted link", () => {
    expect(parseShareLink(link)).toEqual(parsed);
  });

  it("reads the query alone, and one pasted with spaces around it", () => {
    expect(parseShareLink("at=180,500,0.85&b=-6,-6,12&n=sky%20pile")).toEqual(parsed);
    expect(parseShareLink(`  ${link}  `)).toEqual(parsed);
  });

  it("cuts a fragment the address bar added rather than reading it as a name", () => {
    expect(parseShareLink(`${link}#play`)).toEqual(parsed);
  });

  it("refuses a link that carries no bookmark, a framing on its own included", () => {
    expect(parseShareLink("https://example.org/play?at=180,500,0.85")).toBeNull();
    expect(parseShareLink("https://example.org/play?b=-6,-6,12&n=sky%20pile")).toBeNull();
    expect(parseShareLink("https://example.org/play")).toBeNull();
    expect(parseShareLink("have a look at this")).toBeNull();
    expect(parseShareLink("   ")).toBeNull();
  });
});

describe("parseSharedBadge", () => {
  it("reads back a square and a piece", () => {
    expect(parseSharedBadge("-6,-6,12")).toEqual({ dx: -6, dy: -6, size: 12 });
    expect(parseSharedBadge("pieces/0123/012345.avif")).toEqual({
      file: "pieces/0123/012345.avif",
    });
  });

  it("refuses a square no panel would have traced", () => {
    expect(parseSharedBadge("-6,-6,3")).toBeNull();
    expect(parseSharedBadge("-6,-6,25")).toBeNull();
    expect(parseSharedBadge("-6,-6,1e9")).toBeNull();
    expect(parseSharedBadge("-6,-6,0")).toBeNull();
  });

  it("refuses a badge that is neither three numbers nor a piece of this bucket", () => {
    expect(parseSharedBadge("https://elsewhere.example/tile.avif")).toBeNull();
    expect(parseSharedBadge("source_files/12/3_4.webp")).toBeNull();
    expect(parseSharedBadge("-6,-6")).toBeNull();
    expect(parseSharedBadge("-6,-6,12,4")).toBeNull();
    expect(parseSharedBadge("sky,pile,12")).toBeNull();
    expect(parseSharedBadge("")).toBeNull();
    expect(parseSharedBadge(null)).toBeNull();
    expect(parseSharedBadge(["-6,-6,12", "0,0,4"])).toBeNull();
  });
});

describe("parseSharedBookmark", () => {
  it("reads back the draft a link carries", () => {
    expect(parseSharedBookmark("sky pile", "-6,-6,12")).toEqual({
      name: "sky pile",
      badge: { dx: -6, dy: -6, size: 12 },
    });
  });

  it("trims and caps the name like one the player typed", () => {
    expect(parseSharedBookmark("  sky pile  ", "-6,-6,12")?.name).toBe("sky pile");
    expect(parseSharedBookmark("x".repeat(41), "-6,-6,12")).toBeNull();
    expect(parseSharedBookmark("   ", "-6,-6,12")).toBeNull();
  });

  it("refuses a half link rather than offering a draft that cannot be saved", () => {
    expect(parseSharedBookmark("sky pile", undefined)).toBeNull();
    expect(parseSharedBookmark(undefined, "-6,-6,12")).toBeNull();
    expect(parseSharedBookmark("sky pile", "-6,-6,99")).toBeNull();
  });
});

describe("sharedBadgeToBadge", () => {
  it("puts the square back where it was, in the recipient's world units", () => {
    const point = { x: 81_600, y: 120_000 };
    expect(sharedBadgeToBadge({ dx: -6, dy: -6, size: 12 }, point, board1m)).toEqual(
      bookmark.badge,
    );
  });

  it("survives a round trip through the link", () => {
    const url = bookmarkShareUrl("https://example.org", bookmark, board1m, senderZoom);
    const params = new URL(url).searchParams;
    const view = parseSharedView(params.get("at"))!;
    const shared = parseSharedBookmark(params.get("n"), params.get("b"))!;
    const point = sharedViewWorldPoint(view, board1m, zone);
    expect(point).toEqual({ x: bookmark.worldX, y: bookmark.worldY });
    expect(shared.name).toBe(bookmark.name);
    expect(sharedBadgeToBadge(shared.badge, point, board1m)).toEqual(bookmark.badge);
  });

  it("lands on the same picture on a board sliced at another piece size", () => {
    const smaller: BoardFrame = { cols: 1000, rows: 1000, pieceSize: 72 };
    expect(sharedBadgeToBadge({ dx: -6, dy: -6, size: 12 }, { x: 0, y: 0 }, smaller)).toEqual({
      kind: "area",
      x: -432,
      y: -432,
      size: 864,
    });
  });
});

describe("parseSharedView", () => {
  it("reads back what the link carries", () => {
    expect(parseSharedView("-123.5,88,0.313")).toEqual({ x: -123.5, y: 88, zoom: 0.313 });
  });

  it("survives a round trip through the link", () => {
    const view = { x: -412.3, y: 77.9, zoom: 2.5 };
    expect(parseSharedView(formatSharedView(view))).toEqual(view);
  });

  it("refuses a non-finite coordinate", () => {
    expect(parseSharedView("Infinity,0,1")).toBeNull();
    expect(parseSharedView("0,-Infinity,1")).toBeNull();
    expect(parseSharedView("0,0,NaN")).toBeNull();
    expect(parseSharedView("sky pile,0,1")).toBeNull();
  });

  it("refuses a truncated or padded parameter rather than half-applying it", () => {
    expect(parseSharedView("180,250")).toBeNull();
    expect(parseSharedView("180,250,0.31,")).toBeNull();
    expect(parseSharedView("180,,0.31")).toBeNull();
    expect(parseSharedView("")).toBeNull();
  });

  it("refuses anything that is not a string, a repeated parameter included", () => {
    expect(parseSharedView(null)).toBeNull();
    expect(parseSharedView(undefined)).toBeNull();
    expect(parseSharedView(["180,250,0.31", "0,0,1"])).toBeNull();
  });
});

describe("sharedViewWorldPoint", () => {
  it("frames the world point the board coordinate names", () => {
    expect(sharedViewWorldPoint({ x: 0, y: 0, zoom: 1 }, board1m, zone)).toEqual({
      x: 60_000,
      y: 60_000,
    });
    expect(sharedViewWorldPoint({ x: -500, y: 500, zoom: 1 }, board1m, zone)).toEqual({
      x: 0,
      y: 120_000,
    });
  });

  it("holds a point past the board inside the play zone", () => {
    expect(sharedViewWorldPoint({ x: -9000, y: 9000, zoom: 1 }, board1m, zone)).toEqual({
      x: -210_000,
      y: 330_000,
    });
  });

  // A coordinate large enough to overflow the conversion would otherwise reach
  // the camera as an infinity and take the board with it.
  it("holds a coordinate no board can carry inside the zone too", () => {
    expect(sharedViewWorldPoint({ x: 1e308, y: -1e308, zoom: 1 }, board1m, zone)).toEqual({
      x: 330_000,
      y: -210_000,
    });
  });
});
