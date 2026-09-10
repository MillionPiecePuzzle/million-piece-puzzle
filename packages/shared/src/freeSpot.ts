// Where a cluster dropped on a HUD flag lands: the first free cell of a fixed
// lattice anchored on the flag, walked in concentric blocks. The lattice is one
// piece tile plus its clearance, whatever the dropped cluster's own size, so
// everything sent to a flag lands on the same grid and a pile reads as rows
// rather than as a heap. Shared because both ends run it, on the same lattice,
// gap and order: the client for the optimistic placement it shows on release, the
// server for the authoritative one, resolved against its own complete indexes
// rather than the board this client happens to have streamed. Where the client's
// knowledge is complete the two agree and the server's echo moves nothing.

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

// Clear space kept on every side between the landed cluster and its neighbours,
// in pieces, and the rings the outward search is bounded to (20 rings, a 41x41
// cell area).
export const FLAG_DROP_GAP_PIECES = 0.15;
export const FLAG_DROP_SEARCH_RINGS = 20;

// Candidate cells in expanding square blocks around the flag: the flag's own cell
// first, then the border of the 3x3 block of cells around it, then of the 5x5, and
// so on, so a pile stays around the flag it was sent to. Each border is walked in
// reading order, its top row left to right, then its two sides row by row, then
// its bottom row, so which cell a drop takes follows the fill and not how far
// each candidate happens to be from the flag.
export function* ringOffsets(maxRing: number): Generator<readonly [number, number]> {
  yield [0, 0];
  for (let r = 1; r <= maxRing; r++) {
    for (let x = -r; x <= r; x++) yield [x, -r];
    for (let y = -r + 1; y <= r - 1; y++) {
      yield [-r, y];
      yield [r, y];
    }
    for (let x = -r; x <= r; x++) yield [x, r];
  }
}

export type FreeOriginSearch = {
  // Cluster bounds relative to its own origin, which is what the search returns.
  bounds: Aabb;
  // World point to land beside: the flag's foot.
  atX: number;
  atY: number;
  // Clear space kept on every side between the landed cluster and its neighbours.
  gap: number;
  // A single piece's own tile, artwork margins included, which with a gap on
  // either side is the lattice every landing spot sits on. Passed rather than
  // derived from `bounds` so a big cluster lands on the grid the singletons
  // around it are on instead of on one of its own.
  tileSize: number;
  // Rings tried before giving up and landing on the flag regardless.
  maxRing: number;
  // Pulls a candidate origin back inside the play zone. Applied before the
  // occupancy test, so a candidate the clamp moved is never reported clear on a
  // patch it does not actually occupy.
  clamp: (x: number, y: number) => { x: number; y: number };
  isClear: (box: Aabb) => boolean;
  // Optional harder constraint the last-resort landing honours too: a patch
  // failing it is skipped even when every ring is occupied. The server passes the
  // destination tile's piece cap here, since landing over that cap bounces the
  // drop back to where the cluster was picked up instead of honouring it.
  hasRoom?: (box: Aabb) => boolean;
};

// Origin that rests the cluster on the first free cell of the lattice around
// (atX, atY). Falls back to the first cell that only fails `isClear`, then to the
// flag's own: a crowded board still honours the drop rather than refusing it.
export function findFreeOrigin(search: FreeOriginSearch): { x: number; y: number } {
  const { bounds, atX, atY, gap, tileSize, maxRing, clamp, isClear, hasRoom } = search;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  // A gap on either side: the occupancy test grows the cluster by `gap`, so a
  // shorter pitch would put the next cell inside the grown box of the one it is
  // stepping away from and the search would skip a whole ring to clear it.
  const pitch = tileSize + gap * 2;
  // A cluster wider than one cell takes the whole block of cells it needs and is
  // centered in it, the block itself centered on the candidate cell: it stays
  // where the player aimed and its own body still starts on a lattice line.
  const originAt = (ox: number, oy: number): { x: number; y: number } =>
    clamp(
      latticeOrigin(atX, ox, w, gap, pitch) - bounds.minX,
      latticeOrigin(atY, oy, h, gap, pitch) - bounds.minY,
    );
  let crowded: { x: number; y: number } | null = null;
  for (const [ox, oy] of ringOffsets(maxRing)) {
    const origin = originAt(ox, oy);
    const box = paddedWorldBox(bounds, origin.x, origin.y, gap);
    if (hasRoom && !hasRoom(box)) continue;
    if (isClear(box)) return origin;
    crowded ??= origin;
  }
  return crowded ?? originAt(0, 0);
}

// Where a cluster of `extent` rests on one axis when it is put on the lattice
// cell `offset` cells from the flag: as many whole cells as its extent and both
// its gaps need, taken around that cell, with what the block has left over split
// on either side.
function latticeOrigin(
  at: number,
  offset: number,
  extent: number,
  gap: number,
  pitch: number,
): number {
  const cells = Math.max(1, Math.ceil((extent + gap * 2) / pitch));
  const first = offset - Math.floor((cells - 1) / 2);
  return at - pitch / 2 + first * pitch + (cells * pitch - extent) / 2;
}

// Local bounds translated to a world origin and grown by the clearance gap.
export function paddedWorldBox(bounds: Aabb, x: number, y: number, pad: number): Aabb {
  return {
    minX: x + bounds.minX - pad,
    minY: y + bounds.minY - pad,
    maxX: x + bounds.maxX + pad,
    maxY: y + bounds.maxY + pad,
  };
}

// Whether two boxes in the same space overlap. Edge contact does not count, so a
// box resting exactly against another is clear of it.
export function boxesOverlap(a: Aabb, b: Aabb): boolean {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY;
}
