import { describe, it, expect } from "vitest";
import { generatePuzzle } from "./generate.js";
import { piecePath, type PathCommand } from "./path.js";

type Pt = { x: number; y: number };

const countType = (cmds: PathCommand[], t: PathCommand["t"]) =>
  cmds.filter((c) => c.t === t).length;

const edgePoints = (start: Pt, curves: PathCommand[]): Pt[] => {
  const pts: Pt[] = [start];
  for (const c of curves) {
    if (c.t !== "C") throw new Error("expected a cubic command");
    pts.push({ x: c.cp1x, y: c.cp1y }, { x: c.cp2x, y: c.cp2y }, { x: c.x, y: c.y });
  }
  return pts;
};

describe("piecePath", () => {
  it("emits a closed loop starting at the local origin", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 1, cols: 1 });
    const cmds = piecePath(puzzle.pieces[0]!, puzzle.pieceSize);
    expect(cmds[0]).toEqual({ t: "M", x: 0, y: 0 });
    expect(cmds[cmds.length - 1]).toEqual({ t: "Z" });
  });

  it("draws an all-flat border piece as four straight lines", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 1, cols: 1 });
    const cmds = piecePath(puzzle.pieces[0]!, puzzle.pieceSize);
    expect(cmds).toHaveLength(6); // M + 4 L + Z
    expect(countType(cmds, "L")).toBe(4);
    expect(countType(cmds, "C")).toBe(0);
  });

  it("emits eight cubic segments per curved edge", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 3, cols: 3 });
    const center = piecePath(puzzle.pieces[4]!, puzzle.pieceSize);
    expect(countType(center, "C")).toBe(32); // 4 curved edges
    expect(countType(center, "L")).toBe(0);
  });

  it("is deterministic", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 2, cols: 2 });
    expect(piecePath(puzzle.pieces[0]!, puzzle.pieceSize)).toEqual(
      piecePath(puzzle.pieces[0]!, puzzle.pieceSize),
    );
  });

  it("traces a shared edge identically from both neighbours", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 2, cols: 1 });
    const L = puzzle.pieceSize;
    const top = piecePath(puzzle.pieces[0]!, L);
    const bottom = piecePath(puzzle.pieces[1]!, L);

    // pieces[0] path: M, L(top), L(right), 8 C(bottom), L(left), Z
    const topBottomEdge = top.slice(3, 11);
    // pieces[1] path: M, 8 C(top), L(right), L(bottom), L(left), Z
    const bottomTopEdge = bottom.slice(1, 9);

    // pieces[0].bottom starts at the (L, L) corner after walking top and right.
    const topEdgePoints = edgePoints({ x: L, y: L }, topBottomEdge);
    // pieces[1] sits one row down, so shift its local coords by (0, L).
    const bottomEdgePoints = edgePoints({ x: 0, y: 0 }, bottomTopEdge).map((p) => ({
      x: p.x,
      y: p.y + L,
    }));

    // The bottom piece walks the shared edge in the opposite direction.
    const reversed = [...bottomEdgePoints].reverse();
    expect(topEdgePoints).toHaveLength(reversed.length);
    topEdgePoints.forEach((p, i) => {
      expect(p.x).toBeCloseTo(reversed[i]!.x, 9);
      expect(p.y).toBeCloseTo(reversed[i]!.y, 9);
    });
  });
});
