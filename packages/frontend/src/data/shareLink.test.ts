import { describe, it, expect } from "vitest";
import type { PlayZone } from "@mpp/shared";
import type { BoardFrame } from "../canvas/boardCoords";
import { formatSharedView, parseSharedView, shareViewUrl, sharedViewWorldPoint } from "./shareLink";

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

describe("shareViewUrl", () => {
  it("names the play route and carries the whole framing in one parameter", () => {
    expect(shareViewUrl("https://example.org", { x: 180, y: 250, zoom: 0.31 })).toBe(
      "https://example.org/play?at=180,250,0.31",
    );
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
