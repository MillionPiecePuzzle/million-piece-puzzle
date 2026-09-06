import { describe, it, expect } from "vitest";
import {
  boardToWorld,
  clampWorldToZone,
  formatBoardPoint,
  parseBoardPoint,
  worldToBoard,
  type BoardFrame,
} from "./boardCoords";

// The 1M board: 1000x1000 pieces of 120 source pixels, so the frame spans
// (0, 0) to (120000, 120000) in world space.
const board1m: BoardFrame = { cols: 1000, rows: 1000, pieceSize: 120 };

describe("worldToBoard", () => {
  it("reads zero at the center of the frame", () => {
    expect(worldToBoard(60000, 60000, board1m)).toEqual({ x: 0, y: 0 });
  });

  it("reads the frame corners at plus and minus half the piece count", () => {
    expect(worldToBoard(0, 0, board1m)).toEqual({ x: -500, y: -500 });
    expect(worldToBoard(120000, 120000, board1m)).toEqual({ x: 500, y: 500 });
  });

  it("runs Y down, like the world", () => {
    expect(worldToBoard(60000, 60120, board1m).y).toBe(1);
  });

  it("measures Y against the row count, not the column count", () => {
    const wide: BoardFrame = { cols: 100, rows: 10, pieceSize: 80 };
    expect(worldToBoard(0, 0, wide)).toEqual({ x: -50, y: -5 });
  });
});

describe("boardToWorld", () => {
  it("inverts worldToBoard exactly", () => {
    const points: [number, number][] = [
      [0, 0],
      [-500, -500],
      [500, 500],
      [-1000, 743],
      [12.5, -37.5],
    ];
    for (const [x, y] of points) {
      const world = boardToWorld(x, y, board1m);
      expect(worldToBoard(world.x, world.y, board1m)).toEqual({ x, y });
    }
  });

  // A board coordinate handed to the camera (centerOnWorld) and read back off
  // the viewport center has to come back as the same coordinate, or a spot
  // cannot be shared.
  it("survives a round trip through the readout's rounding", () => {
    for (let x = -1000; x <= 1000; x += 7) {
      const world = boardToWorld(x, -x, board1m);
      expect(formatBoardPoint(worldToBoard(world.x, world.y, board1m))).toBe(`(${x}, ${-x})`);
    }
  });
});

describe("formatBoardPoint", () => {
  it("rounds to whole pieces", () => {
    expect(formatBoardPoint({ x: 12.4, y: -37.6 })).toBe("(12, -38)");
  });

  it("shows a point just short of the center as zero, never as minus zero", () => {
    expect(formatBoardPoint(worldToBoard(59999, 59999, board1m))).toBe("(0, 0)");
  });
});

describe("parseBoardPoint", () => {
  it("reads back what the readout writes", () => {
    for (const [x, y] of [
      [0, 0],
      [12, -38],
      [-500, 500],
    ] as const) {
      expect(parseBoardPoint(formatBoardPoint({ x, y }))).toEqual({ x, y });
    }
  });

  it("reads the forms a player types instead of the readout's own", () => {
    expect(parseBoardPoint("12,-38")).toEqual({ x: 12, y: -38 });
    expect(parseBoardPoint("12, -38")).toEqual({ x: 12, y: -38 });
    expect(parseBoardPoint("12 -38")).toEqual({ x: 12, y: -38 });
    expect(parseBoardPoint("  (12 , -38)  ")).toEqual({ x: 12, y: -38 });
  });

  it("reads a fraction of a piece", () => {
    expect(parseBoardPoint("(12.5, -0.25)")).toEqual({ x: 12.5, y: -0.25 });
  });

  it("refuses anything that is not two numbers", () => {
    for (const raw of [
      "",
      "   ",
      "12",
      "12, 38, 5",
      "twelve, -38",
      "12; -38",
      "1e3, 2",
      "(12, -38))",
      "-, 38",
    ]) {
      expect(parseBoardPoint(raw)).toBeNull();
    }
  });

  it("refuses a number too long to stay finite", () => {
    expect(parseBoardPoint(`${"9".repeat(400)}, 0`)).toBeNull();
  });
});

describe("clampWorldToZone", () => {
  const zone = { minX: -4800, minY: -4800, maxX: 124800, maxY: 124800 };

  it("leaves a point inside the zone alone", () => {
    expect(clampWorldToZone({ x: 60000, y: 60000 }, zone)).toEqual({ x: 60000, y: 60000 });
  });

  it("pulls a point outside it back to the nearest corner", () => {
    expect(clampWorldToZone({ x: -1e6, y: 1e6 }, zone)).toEqual({ x: -4800, y: 124800 });
  });
});
