// World-grid helpers for the spatial broadcast index. Pure functions over a
// fixed-pitch world grid: the AABB of a cluster, the cells a rect overlaps, and
// the packing of a signed cell coordinate pair into one map key. The Hub owns the
// index itself (cell -> subscribers); these supply the geometry it scopes with.

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number };

// Local AABB (relative to the group origin) of a cluster, derived from its member
// piece ids. A piece renders at origin + canonicalOffset, where canonicalOffset is
// its solved cell (col * pieceSize, row * pieceSize) with col = id % gridCols and
// row = floor(id / gridCols), the same arithmetic detectSnap uses. A singleton is
// one piece footprint; a cluster is the union of its pieces. Position-independent,
// so it is computed once at merge and translated by the live origin on each drag.
export function localAabbForPieces(pieceIds: number[], gridCols: number, pieceSize: number): Aabb {
  let minCol = Infinity;
  let minRow = Infinity;
  let maxCol = -Infinity;
  let maxRow = -Infinity;
  for (const id of pieceIds) {
    const col = id % gridCols;
    const row = Math.floor(id / gridCols);
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }
  return {
    minX: minCol * pieceSize,
    minY: minRow * pieceSize,
    maxX: (maxCol + 1) * pieceSize,
    maxY: (maxRow + 1) * pieceSize,
  };
}

// World AABB of a cluster whose origin sits at (originX, originY): the local AABB
// translated by the origin. A null local AABB (a group written before AABBs were
// stored) falls back to a zero-size rect at the origin, i.e. the old point-based
// scoping, so scoping degrades gracefully rather than failing.
export function worldAabbFor(
  local: Aabb | null | undefined,
  originX: number,
  originY: number,
): Aabb {
  if (!local) return { minX: originX, minY: originY, maxX: originX, maxY: originY };
  return {
    minX: local.minX + originX,
    minY: local.minY + originY,
    maxX: local.maxX + originX,
    maxY: local.maxY + originY,
  };
}

// Packs a signed cell coordinate pair into one safe-integer key. Cells span a
// small range around the play zone (negatives included), well inside +-2^23, so
// the offset-and-stride packing is collision-free across the whole board.
const CELL_KEY_BITS = 24;
const CELL_KEY_HALF = 1 << (CELL_KEY_BITS - 1);
const CELL_KEY_STRIDE = 1 << CELL_KEY_BITS;
export function cellKey(cx: number, cy: number): number {
  return (cx + CELL_KEY_HALF) * CELL_KEY_STRIDE + (cy + CELL_KEY_HALF);
}

// Inverse of cellKey. Note the frontend packs the same world grid independently
// (packages/frontend/src/canvas/groupGrid.ts, a different bit layout): the two
// are not interchangeable, only the resulting Aabb crosses the wire.
export function unpackCellKey(key: number): { cx: number; cy: number } {
  const cx = Math.floor(key / CELL_KEY_STRIDE) - CELL_KEY_HALF;
  const cy = (key % CELL_KEY_STRIDE) - CELL_KEY_HALF;
  return { cx, cy };
}

// The cell keys a world rect overlaps, or null when it overlaps more than
// maxCells. The caller reads null as "everyone": a viewport that large becomes a
// global subscriber and a cluster that large fans its broadcast out to all
// clients, which bounds both the per-client subscription set and the per-event
// cell walk.
export function cellsForRect(aabb: Aabb, cellSize: number, maxCells: number): number[] | null {
  const cxMin = Math.floor(aabb.minX / cellSize);
  const cxMax = Math.floor(aabb.maxX / cellSize);
  const cyMin = Math.floor(aabb.minY / cellSize);
  const cyMax = Math.floor(aabb.maxY / cellSize);
  if ((cxMax - cxMin + 1) * (cyMax - cyMin + 1) > maxCells) return null;
  const cells: number[] = [];
  for (let cx = cxMin; cx <= cxMax; cx++) {
    for (let cy = cyMin; cy <= cyMax; cy++) {
      cells.push(cellKey(cx, cy));
    }
  }
  return cells;
}
