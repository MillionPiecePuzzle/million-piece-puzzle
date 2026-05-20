import { describe, it, expect } from "vitest";
import { generatePuzzle } from "./generate.js";
import type { CurvedEdge, Edge } from "./edge.js";

const curved = (e: Edge): CurvedEdge => {
  if (e.type !== "curved") throw new Error("expected a curved edge");
  return e;
};

type ShapeParam =
  | "center"
  | "neck"
  | "depth"
  | "shoulder"
  | "tension"
  | "tilt"
  | "shoulderRun"
  | "headRoundness";

const paramRanges: ReadonlyArray<readonly [ShapeParam, readonly [number, number]]> = [
  ["center", [0.46, 0.54]],
  ["neck", [0.055, 0.085]],
  ["depth", [0.24, 0.3]],
  ["shoulder", [-0.025, -0.005]],
  ["tension", [0.25, 0.4]],
  ["tilt", [-0.03, 0.03]],
  ["shoulderRun", [0.1, 0.16]],
  ["headRoundness", [0.45, 0.55]],
];

const sameShape = (a: CurvedEdge, b: CurvedEdge): boolean =>
  paramRanges.every(([param]) => a[param] === b[param]);

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

  it("produces a valid puzzle at 10 000 pieces (100x100)", () => {
    const rows = 100;
    const cols = 100;
    const puzzle = generatePuzzle({ seed: "ten-thousand", rows, cols });
    expect(puzzle.pieces).toHaveLength(10_000);

    const at = (row: number, col: number) => puzzle.pieces[row * cols + col]!;
    const violations: string[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const piece = at(row, col);
        const id = row * cols + col;
        if (piece.id !== id || piece.row !== row || piece.col !== col) {
          violations.push(`piece ${id}: wrong id/row/col`);
        }
        if (
          piece.canonicalOffset.x !== col * puzzle.pieceSize ||
          piece.canonicalOffset.y !== row * puzzle.pieceSize
        ) {
          violations.push(`piece ${id}: wrong canonicalOffset`);
        }

        const isBorder = {
          top: row === 0,
          bottom: row === rows - 1,
          left: col === 0,
          right: col === cols - 1,
        };
        for (const side of ["top", "bottom", "left", "right"] as const) {
          const edge = piece.edges[side];
          const expected = isBorder[side] ? "flat" : "curved";
          if (edge.type !== expected) {
            violations.push(`piece ${id} ${side}: expected ${expected}, got ${edge.type}`);
            continue;
          }
          if (edge.type === "curved") {
            for (const [param, [lo, hi]] of paramRanges) {
              const value = edge[param];
              if (!Number.isFinite(value) || value < lo || value > hi) {
                violations.push(`piece ${id} ${side}.${param}=${value} out of [${lo}, ${hi}]`);
              }
            }
          }
        }

        if (col < cols - 1) {
          const a = piece.edges.right;
          const b = at(row, col + 1).edges.left;
          if (a.type !== "curved" || b.type !== "curved") {
            violations.push(`piece ${id}: interior horizontal edge not curved`);
          } else if (a.sign !== -b.sign || !sameShape(a, b)) {
            violations.push(`piece ${id}: right edge mismatches neighbour left`);
          }
        }
        if (row < rows - 1) {
          const c = piece.edges.bottom;
          const d = at(row + 1, col).edges.top;
          if (c.type !== "curved" || d.type !== "curved") {
            violations.push(`piece ${id}: interior vertical edge not curved`);
          } else if (c.sign !== -d.sign || !sameShape(c, d)) {
            violations.push(`piece ${id}: bottom edge mismatches neighbour top`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("is deterministic at 10 000 pieces", () => {
    const options = { seed: "ten-thousand", rows: 100, cols: 100 };
    expect(generatePuzzle(options)).toEqual(generatePuzzle(options));
  });
});
