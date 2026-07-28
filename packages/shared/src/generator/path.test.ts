import { describe, it, expect } from "vitest";
import { generatePuzzle } from "./generate.js";
import {
  piecePath,
  piecePathD,
  pieceMaskSvg,
  pieceBorderSvg,
  PIECE_BORDER_COLOR,
  PIECE_BORDER_WIDTH,
  type PathCommand,
} from "./path.js";

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

describe("piecePathD", () => {
  it("shifts every command by the given offset", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 1, cols: 1 });
    const cmds = piecePath(puzzle.pieces[0]!, puzzle.pieceSize);
    const d = piecePathD(cmds, 10, 20);
    expect(d.startsWith("M10 20")).toBe(true);
  });

  it("uses independent x/y offsets, unlike a single scalar margin", () => {
    const puzzle = generatePuzzle({ seed: "s", rows: 1, cols: 1 });
    const cmds = piecePath(puzzle.pieces[0]!, puzzle.pieceSize);
    const d = piecePathD(cmds, 5, 7);
    expect(d.startsWith("M5 7")).toBe(true);
  });
});

describe("pieceMaskSvg / pieceBorderSvg", () => {
  const puzzle = generatePuzzle({ seed: "s", rows: 2, cols: 2 });
  const size = puzzle.pieceSize;
  const dA = piecePathD(piecePath(puzzle.pieces[0]!, size), 0, 0);
  const dB = piecePathD(piecePath(puzzle.pieces[1]!, size), size, 0);

  it("emits one fill-only path per piece for the mask", () => {
    const svg = pieceMaskSvg([dA, dB], size * 2, size).toString("utf8");
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg).toContain('fill="#fff"');
    expect(svg).not.toContain("stroke");
  });

  it("emits one stroke-only path per piece in the shared border style", () => {
    const svg = pieceBorderSvg([dA, dB], size * 2, size).toString("utf8");
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg).toContain('fill="none"');
    expect(svg).toContain(`stroke-width="${PIECE_BORDER_WIDTH}"`);
    expect(svg).toContain(PIECE_BORDER_COLOR.toString(16));
  });

  it("wraps at the given width/height, independent of piece count", () => {
    const svg = pieceMaskSvg([dA], 123, 45).toString("utf8");
    expect(svg).toContain('width="123"');
    expect(svg).toContain('height="45"');
  });
});
