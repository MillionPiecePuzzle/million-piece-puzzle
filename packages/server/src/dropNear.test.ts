import { describe, it, expect } from "vitest";
import { resolveDropNearOrigin, type DropNearIndexes } from "./dropNear.js";
import { GroupIndex } from "./groupIndex.js";
import { LockedPieceIndex } from "./lockedPieces.js";

// 10x10 board of 100px pieces on a 1000px world grid, so one cell holds exactly
// the solved 10x10 block and a step of one patch (piece + margin + gap on both
// sides, 170) is small enough to keep a ring inside its cell.
const PIECE = 100;
// A piece's artwork runs this far past its grid cell on every side, which is what
// the client sizes a cluster by and what the spacing here has to match.
const MARGIN = 20;
const CELL = 1000;
const COLS = 10;
const ROWS = 10;
const PLAY_ZONE = { minX: -2000, minY: -2000, maxX: 4000, maxY: 4000 };

// A one-piece cluster whose body starts at its own origin, so the origin the
// search answers with reads directly as the landing spot.
const CLUSTER = {
  groupId: 4,
  localAabb: { minX: 0, minY: 0, maxX: PIECE, maxY: PIECE },
  size: 1,
};

function makeIndexes(overrides: Partial<DropNearIndexes> = {}): DropNearIndexes {
  return {
    groupIndex: new GroupIndex(CELL),
    lockedPieces: new LockedPieceIndex(COLS, ROWS, PIECE, CELL, COLS * ROWS),
    playZone: PLAY_ZONE,
    pieceSize: PIECE,
    pieceMargin: MARGIN,
    tilePieceCap: 100,
    ...overrides,
  };
}

// The body of a resting singleton, as the group index holds it.
function rest(index: GroupIndex, groupId: number, x: number, y: number, size = 1): void {
  index.set(groupId, x, y, {
    originX: x,
    originY: y,
    size,
    width: PIECE,
    height: PIECE,
  });
}

describe("resolveDropNearOrigin", () => {
  it("centers the cluster on the flag when nothing stands there", () => {
    expect(resolveDropNearOrigin(makeIndexes(), CLUSTER, 2500, 2500)).toEqual({
      x: 2450,
      y: 2450,
    });
  });

  it("steps one patch aside from a resting cluster", () => {
    const indexes = makeIndexes();
    rest(indexes.groupIndex, 7, 2450, 2450);
    // One patch up: the cluster's own extent, its margins, and a gap on either
    // side (100 + 2 * 20 + 2 * 15).
    expect(resolveDropNearOrigin(indexes, CLUSTER, 2500, 2500)).toEqual({ x: 2450, y: 2280 });
  });

  it("ignores the cluster being dropped, which still rests where it was picked up", () => {
    const indexes = makeIndexes();
    rest(indexes.groupIndex, CLUSTER.groupId, 2450, 2450);
    expect(resolveDropNearOrigin(indexes, CLUSTER, 2500, 2500)).toEqual({ x: 2450, y: 2450 });
  });

  it("steps aside from locked pieces, which hold their solved positions", () => {
    const indexes = makeIndexes();
    // Piece 22 is solved at (200, 200); the flag stands on it.
    indexes.lockedPieces.lock([22]);
    expect(resolveDropNearOrigin(indexes, CLUSTER, 250, 250)).toEqual({ x: 200, y: 30 });
  });

  it("lands in a neighbouring tile when the flag's own is at the piece cap", () => {
    const indexes = makeIndexes({ tilePieceCap: 4 });
    // Cell (0,0) is full, with the resting cluster far enough from the flag to
    // leave its patch clear: only the cap stands in the way there.
    rest(indexes.groupIndex, 7, 100, 100, 4);
    // The flag sits one patch short of the cell boundary at x = 1000.
    const origin = resolveDropNearOrigin(indexes, CLUSTER, 990, 500);
    expect(origin).toEqual({ x: 1110, y: 450 });
    expect(indexes.groupIndex.cellPieceCount(origin.x, origin.y, CLUSTER.groupId)).toBe(0);
  });

  it("lands on the flag when no tile in reach has room", () => {
    const indexes = makeIndexes({ tilePieceCap: 0 });
    expect(resolveDropNearOrigin(indexes, CLUSTER, 2500, 2500)).toEqual({ x: 2450, y: 2450 });
  });

  it("keeps the cluster inside the play zone, flag included", () => {
    const origin = resolveDropNearOrigin(makeIndexes(), CLUSTER, 99999, 500);
    // Its right margin stops at the zone edge, like a cluster dragged into it.
    expect(origin).toEqual({ x: PLAY_ZONE.maxX - PIECE - MARGIN, y: 450 });
  });
});
