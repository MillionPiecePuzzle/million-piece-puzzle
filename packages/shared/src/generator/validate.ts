/**
 * Streaming validation of generated puzzle geometry at arbitrary scale.
 *
 * Walks the grid row by row holding only the current and previous row, so a
 * full 1M-piece board is checked without ever materializing it. It verifies the
 * structural invariants (ids, canonical offsets, border/interior edge kinds,
 * param ranges, neighbour sign and param agreement) and counts distinct edge
 * seeds to prove every shared edge, and therefore every piece, is unique.
 *
 * Uniqueness is measured on the edge seed rather than on the param tuple: each
 * seed drives a deterministic mulberry32 stream, so distinct seeds yield
 * distinct silhouettes, and a u32 set stays cheap at ~2M edges where a set of
 * float tuples would not. A pathological base seed could still collide, so the
 * check is per-seed evidence, not an entropy guarantee (see DECISIONS).
 */

import type { CurvedEdge, Edge, PieceGeometry } from "./edge.js";
import { generatePieceGeometry, sharedEdgeSeed } from "./generate.js";
import { seedFromString } from "./prng.js";

export type ShapeParam =
  | "center"
  | "neck"
  | "depth"
  | "shoulder"
  | "tension"
  | "tilt"
  | "shoulderRun"
  | "headRoundness";

// The spec ranges every curved param must fall within, mirroring the lerp
// bounds in generate.ts. The validator owns them as the oracle: a range changed
// in the generator but not here is reported as out-of-range, which is correct.
export const PARAM_RANGES: ReadonlyArray<readonly [ShapeParam, number, number]> = [
  ["center", 0.46, 0.54],
  ["neck", 0.055, 0.085],
  ["depth", 0.24, 0.3],
  ["shoulder", -0.025, -0.005],
  ["tension", 0.25, 0.4],
  ["tilt", -0.03, 0.03],
  ["shoulderRun", 0.1, 0.16],
  ["headRoundness", 0.45, 0.55],
];

export type GenerationValidationOptions = {
  seed: string;
  rows: number;
  cols: number;
  pieceSize?: number;
  maxViolationSamples?: number;
};

export type GenerationReport = {
  seed: string;
  rows: number;
  cols: number;
  pieceSize: number;
  pieces: number;
  interiorEdges: number;
  uniqueEdges: number;
  durationMs: number;
  violationCount: number;
  violationSamples: string[];
  ok: boolean;
};

const DEFAULT_MAX_SAMPLES = 50;

function checkRanges(
  edge: CurvedEdge,
  id: number,
  side: string,
  report: (m: string) => void,
): void {
  for (const [param, lo, hi] of PARAM_RANGES) {
    const value = edge[param];
    if (!Number.isFinite(value) || value < lo || value > hi) {
      report(`piece ${id} ${side}.${param}=${value} out of [${lo}, ${hi}]`);
    }
  }
}

// A shared edge seen from both pieces: opposite sign, identical shape params.
function checkSharedEdge(
  a: Edge,
  b: Edge,
  id: number,
  side: "left" | "top",
  report: (m: string) => void,
): void {
  if (a.type !== "curved" || b.type !== "curved") {
    report(`piece ${id} ${side}: interior shared edge not curved on both sides`);
    return;
  }
  if (a.sign !== -b.sign) {
    report(`piece ${id} ${side}: shared edge sign not opposite (${a.sign} vs ${b.sign})`);
  }
  for (const [param] of PARAM_RANGES) {
    if (a[param] !== b[param]) {
      report(
        `piece ${id} ${side}: shared edge param ${param} mismatch (${a[param]} vs ${b[param]})`,
      );
    }
  }
}

export function validateGeneration(options: GenerationValidationOptions): GenerationReport {
  const { seed, rows, cols } = options;
  if (rows < 1 || cols < 1) {
    throw new Error("rows and cols must be >= 1");
  }
  const pieceSize = options.pieceSize ?? 100;
  const maxSamples = options.maxViolationSamples ?? DEFAULT_MAX_SAMPLES;
  const base = seedFromString(seed);
  const start = Date.now();

  const violationSamples: string[] = [];
  let violationCount = 0;
  const report = (message: string) => {
    violationCount++;
    if (violationSamples.length < maxSamples) violationSamples.push(message);
  };

  const edgeSeeds = new Set<number>();
  let prevRow: PieceGeometry[] | null = null;

  for (let row = 0; row < rows; row++) {
    const curRow: PieceGeometry[] = new Array<PieceGeometry>(cols);
    for (let col = 0; col < cols; col++) {
      const id = row * cols + col;
      const piece = generatePieceGeometry(base, rows, cols, pieceSize, id);
      curRow[col] = piece;

      if (piece.id !== id || piece.row !== row || piece.col !== col) {
        report(`piece ${id}: wrong id/row/col -> ${piece.id}/${piece.row}/${piece.col}`);
      }
      if (
        piece.canonicalOffset.x !== col * pieceSize ||
        piece.canonicalOffset.y !== row * pieceSize
      ) {
        report(`piece ${id}: wrong canonicalOffset`);
      }

      const isBorder = {
        top: row === 0,
        bottom: row === rows - 1,
        left: col === 0,
        right: col === cols - 1,
      };
      for (const side of ["top", "right", "bottom", "left"] as const) {
        const edge = piece.edges[side];
        const expected = isBorder[side] ? "flat" : "curved";
        if (edge.type !== expected) {
          report(`piece ${id} ${side}: expected ${expected}, got ${edge.type}`);
          continue;
        }
        if (edge.type === "curved") checkRanges(edge, id, side, report);
      }

      if (col > 0)
        checkSharedEdge(curRow[col - 1]!.edges.right, piece.edges.left, id, "left", report);
      if (prevRow) checkSharedEdge(prevRow[col]!.edges.bottom, piece.edges.top, id, "top", report);

      // Count each shared edge once, attributed to the piece on its top/left.
      if (row < rows - 1) edgeSeeds.add(sharedEdgeSeed(base, "h", row, col));
      if (col < cols - 1) edgeSeeds.add(sharedEdgeSeed(base, "v", row, col));
    }
    prevRow = curRow;
  }

  const pieces = rows * cols;
  const interiorEdges = (rows - 1) * cols + rows * (cols - 1);
  const uniqueEdges = edgeSeeds.size;
  if (uniqueEdges !== interiorEdges) {
    report(
      `edge uniqueness: ${interiorEdges - uniqueEdges} of ${interiorEdges} shared edges collide on their seed`,
    );
  }

  return {
    seed,
    rows,
    cols,
    pieceSize,
    pieces,
    interiorEdges,
    uniqueEdges,
    durationMs: Date.now() - start,
    violationCount,
    violationSamples,
    ok: violationCount === 0,
  };
}
