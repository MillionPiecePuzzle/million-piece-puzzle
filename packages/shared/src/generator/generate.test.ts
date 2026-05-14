import { describe, it, expect } from "vitest";
import { generatePuzzle } from "./generate.js";
import type { CurvedEdge, Edge } from "./edge.js";

const curved = (e: Edge): CurvedEdge => {
  if (e.type !== "curved") throw new Error("expected a curved edge");
  return e;
};

describe("generatePuzzle", () => {
  it("rejects non-positive dimensions", () => {
    expect(() => generatePuzzle({ seed: "s", rows: 0, cols: 3 })).toThrow();
    expect(() => generatePuzzle({ seed: "s", rows: 3, cols: 0 })).toThrow();
  });

  it("produces rows * cols pieces with row-major ids", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 3, cols: 4 });
    expect(puzzle.pieces).toHaveLength(12);
    puzzle.pieces.forEach((piece, index) => {
      expect(piece.id).toBe(index);
      expect(piece.row).toBe(Math.floor(index / 4));
      expect(piece.col).toBe(index % 4);
      expect(piece.canonicalOffset).toEqual({
        x: piece.col * puzzle.pieceSize,
        y: piece.row * puzzle.pieceSize,
      });
    });
  });

  it("defaults pieceSize to 100 and snapTolerance to 0.2 * pieceSize", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 2, cols: 2 });
    expect(puzzle.pieceSize).toBe(100);
    expect(puzzle.snapTolerance).toBe(20);
  });

  it("honours explicit pieceSize and snapTolerance", () => {
    const puzzle = generatePuzzle({
      seed: "s",
      rows: 2,
      cols: 2,
      pieceSize: 80,
      snapTolerance: 5,
    });
    expect(puzzle.pieceSize).toBe(80);
    expect(puzzle.snapTolerance).toBe(5);
  });

  it("makes border edges flat and interior edges curved", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 3, cols: 3 });
    const at = (row: number, col: number) => puzzle.pieces[row * 3 + col]!;

    expect(at(0, 0).edges.top.type).toBe("flat");
    expect(at(0, 0).edges.left.type).toBe("flat");
    expect(at(2, 2).edges.bottom.type).toBe("flat");
    expect(at(2, 2).edges.right.type).toBe("flat");

    const center = at(1, 1);
    expect(center.edges.top.type).toBe("curved");
    expect(center.edges.right.type).toBe("curved");
    expect(center.edges.bottom.type).toBe("curved");
    expect(center.edges.left.type).toBe("curved");
  });

  it("gives neighbours a shared edge with opposite sign but identical shape params", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 2, cols: 2 });
    const topLeft = puzzle.pieces[0]!;
    const topRight = puzzle.pieces[1]!;
    const bottomLeft = puzzle.pieces[2]!;

    // Horizontal neighbours share topLeft.right / topRight.left.
    const a = curved(topLeft.edges.right);
    const b = curved(topRight.edges.left);
    expect(a.sign).toBe(-b.sign);
    expect(a.center).toBe(b.center);
    expect(a.neck).toBe(b.neck);
    expect(a.depth).toBe(b.depth);
    expect(a.headRoundness).toBe(b.headRoundness);

    // Vertical neighbours share topLeft.bottom / bottomLeft.top.
    const c = curved(topLeft.edges.bottom);
    const d = curved(bottomLeft.edges.top);
    expect(c.sign).toBe(-d.sign);
    expect(c.depth).toBe(d.depth);
    expect(c.tension).toBe(d.tension);
  });

  it("is deterministic for the same seed and differs across seeds", () => {
    const a = generatePuzzle({ seed: "alpha", rows: 3, cols: 3 });
    const b = generatePuzzle({ seed: "alpha", rows: 3, cols: 3 });
    const c = generatePuzzle({ seed: "beta", rows: 3, cols: 3 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
