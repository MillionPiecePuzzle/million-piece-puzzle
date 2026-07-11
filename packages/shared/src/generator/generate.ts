/**
 * Deterministic puzzle geometry generator.
 *
 * Every shared edge derives its parameters from a canonical subseed keyed by
 * the edge's grid position. Both pieces sharing the edge compute the same
 * params; the piece whose `bottom` or `right` uses the edge takes the
 * canonical sign, the piece whose `top` or `left` uses it takes the opposite.
 */

import { type Edge, type PieceGeometry, type PuzzleGeometry } from "./edge.js";
import { mulberry32, seedFromString, subseed } from "./prng.js";

export type GenerateOptions = {
  seed: string;
  rows: number;
  cols: number;
  pieceSize?: number;
  snapTolerance?: number;
};

const HORIZONTAL_DOMAIN = 0;
const VERTICAL_DOMAIN = 1;

// Seed of one shared edge, keyed by its position in the grid of edges.
// `"h"` is a horizontal edge between rows `line` and `line + 1` at column
// `index`; `"v"` is a vertical edge between columns `index` and `index + 1` at
// row `line`. Both pieces sharing the edge derive their params from this seed,
// so the keying lives here once for the generator and any validator.
export function sharedEdgeSeed(
  base: number,
  orientation: "h" | "v",
  line: number,
  index: number,
): number {
  return subseed(base, orientation === "h" ? HORIZONTAL_DOMAIN : VERTICAL_DOMAIN, line, index);
}

const lerp = (rng: () => number, lo: number, hi: number) => lo + (hi - lo) * rng();

function curvedEdge(edgeSeed: number, flipped: boolean): Edge {
  const rng = mulberry32(edgeSeed);
  const canonicalSign: 1 | -1 = rng() < 0.5 ? -1 : 1;
  const sign = (flipped ? -canonicalSign : canonicalSign) as 1 | -1;
  // headRoundness/depth ranges are chosen so the bulb radius (headRoundness * depth)
  // always exceeds the neck half-width (0.45 * 0.24 > 0.085): a narrower bulb reads
  // as a rectangular tab instead of a lightbulb silhouette.
  return {
    type: "curved",
    sign,
    center: lerp(rng, 0.46, 0.54),
    neck: lerp(rng, 0.055, 0.085),
    depth: lerp(rng, 0.24, 0.3),
    shoulder: lerp(rng, -0.025, -0.005),
    tension: lerp(rng, 0.25, 0.4),
    tilt: lerp(rng, -0.03, 0.03),
    shoulderRun: lerp(rng, 0.1, 0.16),
    headRoundness: lerp(rng, 0.45, 0.55),
  };
}

// Geometry of a single piece, derived from the puzzle's base seed and the grid
// dimensions. `base` is `seedFromString(seed)`, hoisted out so a caller building
// pieces one at a time hashes the seed once. Output is independent of the order
// pieces are generated in: each shared edge keys its own subseed by grid
// position, so neighbors agree regardless of when either is built.
export function generatePieceGeometry(
  base: number,
  rows: number,
  cols: number,
  pieceSize: number,
  id: number,
): PieceGeometry {
  const row = Math.floor(id / cols);
  const col = id % cols;
  const top: Edge =
    row === 0 ? { type: "flat" } : curvedEdge(sharedEdgeSeed(base, "h", row - 1, col), true);
  const bottom: Edge =
    row === rows - 1 ? { type: "flat" } : curvedEdge(sharedEdgeSeed(base, "h", row, col), false);
  const left: Edge =
    col === 0 ? { type: "flat" } : curvedEdge(sharedEdgeSeed(base, "v", row, col - 1), true);
  const right: Edge =
    col === cols - 1 ? { type: "flat" } : curvedEdge(sharedEdgeSeed(base, "v", row, col), false);
  return {
    id,
    row,
    col,
    canonicalOffset: { x: col * pieceSize, y: row * pieceSize },
    edges: { top, right, bottom, left },
  };
}

export function generatePuzzle(options: GenerateOptions): PuzzleGeometry {
  const { seed, rows, cols } = options;
  if (rows < 1 || cols < 1) {
    throw new Error("rows and cols must be >= 1");
  }
  const pieceSize = options.pieceSize ?? 100;
  const snapTolerance = options.snapTolerance ?? 0.2 * pieceSize;
  const base = seedFromString(seed);

  const pieces: PieceGeometry[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      pieces.push(generatePieceGeometry(base, rows, cols, pieceSize, row * cols + col));
    }
  }
  return { rows, cols, pieceSize, snapTolerance, pieces };
}
