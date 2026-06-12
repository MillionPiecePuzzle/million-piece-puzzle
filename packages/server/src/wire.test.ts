import { describe, it, expect } from "vitest";
import {
  buildWireContext,
  toWireId,
  toGridId,
  anchorWorldX,
  anchorWorldY,
  originXFromAnchor,
  originYFromAnchor,
  wirePieces,
  wireGroup,
  wirePieceRuntime,
} from "./wire.js";

const GRID_COLS = 10;
const GRID_ROWS = 10;
const PIECE = 50;
const N = GRID_COLS * GRID_ROWS;
const ctx = buildWireContext("wire-test-seed", N, GRID_COLS, PIECE);

describe("wire id permutation", () => {
  it("round-trips every id (encode then decode is identity)", () => {
    for (let gridId = 0; gridId < N; gridId++) {
      expect(toGridId(ctx, toWireId(ctx, gridId))).toBe(gridId);
    }
  });

  it("permutes (ids are not shipped in solved order)", () => {
    let fixed = 0;
    for (let i = 0; i < N; i++) if (toWireId(ctx, i) === i) fixed++;
    expect(fixed).toBeLessThan(N);
  });
});

describe("anchor position round-trip", () => {
  it("decode of the encoded anchor position recovers the internal origin", () => {
    const gridGroupId = 23; // col 3, row 2
    const originX = 137.5;
    const originY = -42.25;
    const ax = anchorWorldX(ctx, gridGroupId, originX);
    const ay = anchorWorldY(ctx, gridGroupId, originY);
    // The anchor world position is the origin plus the anchor's solved-cell offset.
    expect(ax).toBe(originX + 3 * PIECE);
    expect(ay).toBe(originY + 2 * PIECE);
    // The server decodes the client's anchor position back to the same origin.
    expect(originXFromAnchor(ctx, gridGroupId, ax)).toBe(originX);
    expect(originYFromAnchor(ctx, gridGroupId, ay)).toBe(originY);
  });
});

describe("member offsets", () => {
  it("computes (dx, dy) relative to the cluster anchor", () => {
    // Cluster {5, 6, 15}: anchor is the min id 5 (col 5, row 0).
    const anchor = 5;
    const pieces = wirePieces(ctx, anchor, [5, 6, 15]);
    const byId = new Map(pieces.map((p) => [toGridId(ctx, p.id), p]));
    expect(byId.get(5)).toMatchObject({ dx: 0, dy: 0 });
    expect(byId.get(6)).toMatchObject({ dx: 1, dy: 0 });
    expect(byId.get(15)).toMatchObject({ dx: 0, dy: 1 });
  });

  it("allows a negative dx when the anchor is on an earlier row", () => {
    // Cluster {5, 10}: anchor 5 (col 5, row 0); piece 10 is col 0, row 1.
    const pieces = wirePieces(ctx, 5, [10]);
    expect(pieces[0]).toMatchObject({ dx: -5, dy: 1 });
  });
});

describe("group encoding", () => {
  it("encodes a loose group to its anchor world position and permuted id", () => {
    const g = { id: 23, worldX: 100, worldY: 200, size: 1, locked: false, heldBy: null };
    const w = wireGroup(ctx, g);
    expect(w.id).toBe(toWireId(ctx, 23));
    expect(w.worldX).toBe(100 + 3 * PIECE);
    expect(w.worldY).toBe(200 + 2 * PIECE);
    expect(w.size).toBe(1);
    expect(w.locked).toBe(false);
  });

  it("encodes a locked cluster (origin 0,0) to its true solved position", () => {
    const gridGroupId = 23; // col 3, row 2 -> solved (150, 100)
    const g = { id: gridGroupId, worldX: 0, worldY: 0, size: 4, locked: true, heldBy: null };
    const w = wireGroup(ctx, g);
    expect(w.worldX).toBe(3 * PIECE);
    expect(w.worldY).toBe(2 * PIECE);
    expect(w.locked).toBe(true);
  });
});

describe("piece runtime encoding", () => {
  it("permutes id and groupId and attaches the anchor offset", () => {
    // Piece 16 (col 6, row 1) in group anchored at 5 (col 5, row 0).
    const w = wirePieceRuntime(ctx, { id: 16, groupId: 5, rotation: 0 });
    expect(w.id).toBe(toWireId(ctx, 16));
    expect(w.groupId).toBe(toWireId(ctx, 5));
    expect(w.dx).toBe(1);
    expect(w.dy).toBe(1);
  });
});

// Guard the grid metrics so the round-trip tests above are meaningful.
describe("wire context", () => {
  it("carries the grid metrics", () => {
    expect(ctx.gridCols).toBe(GRID_COLS);
    expect(ctx.pieceSize).toBe(PIECE);
    expect(ctx.wireForGrid).toHaveLength(N);
    expect(GRID_ROWS).toBe(N / GRID_COLS);
  });
});
