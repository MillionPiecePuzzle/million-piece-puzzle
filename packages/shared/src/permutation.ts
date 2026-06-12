/**
 * Deterministic id permutation: the relabeling that hides solved-grid adjacency.
 *
 * Piece and group ids are grid ids server-side (`gridId = row * cols + col`), so
 * `id % cols` reveals a piece's solved cell. `buildPermutation` derives a fixed
 * bijection from the generation seed and a Fisher-Yates shuffle over the existing
 * mulberry32 PRNG, so the slicer and the server compute the identical permutation
 * with nothing stored: the wire only ever carries `wireId = P(gridId)`, opaque to
 * a client. At 1M the two Int32Arrays are ~8 MB of process memory, built once at
 * boot.
 */

import { mulberry32, seedFromString } from "./generator/prng.js";

export type Permutation = {
  // wireForGrid[gridId] = wireId; gridForWire is its inverse. Both length n.
  wireForGrid: Int32Array;
  gridForWire: Int32Array;
};

export function buildPermutation(seed: string, n: number): Permutation {
  const wireForGrid = new Int32Array(n);
  for (let i = 0; i < n; i++) wireForGrid[i] = i;
  // A fresh mulberry32 stream off the seed, independent of the per-edge geometry
  // streams (which key their own subseeds), so relabeling never disturbs geometry.
  const rng = mulberry32(seedFromString(seed));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = wireForGrid[i]!;
    wireForGrid[i] = wireForGrid[j]!;
    wireForGrid[j] = tmp;
  }
  const gridForWire = new Int32Array(n);
  for (let gridId = 0; gridId < n; gridId++) gridForWire[wireForGrid[gridId]!] = gridId;
  return { wireForGrid, gridForWire };
}
