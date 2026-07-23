// In-memory locked-piece index: which pieces are locked, answering "which
// locked pieces sit in these cells" for the region_state resync stream.
//
// A locked piece's cell is a pure function of its own grid id (its solved
// (col, row) is fixed at generation and never changes once locked), unlike a
// group's arbitrary live drop position (see GroupIndex, which does need a
// stored cell -> groupIds map for exactly that reason). So this needs no
// reverse index: a flat "is it locked" bit per piece plus the grid geometry is
// enough to recompute a cell's candidates on read. The minimap density grid
// already treats a locked piece's cell the same way (minimap.ts's
// cellIndexForPiece(p.id, 0, 0, ...), computed, never looked up).

import { unpackCellKey } from "./worldGrid.js";

// The grid columns (or rows, called with gridRows) a world-grid cell index cx
// owns at this pieceSize/cellSize ratio: column `col` belongs to cx exactly
// when floor(col * pieceSize / cellSize) === cx. Cell boundaries need not fall
// on a piece boundary (cellSize is a fixed constant, pieceSize varies per
// puzzle manifest), so this is derived rather than a plain division, and every
// column belongs to exactly one cell index, never two.
function ownedRange(
  cellIndex: number,
  cellSize: number,
  pieceSize: number,
  gridLength: number,
): [number, number] {
  const min = Math.max(0, Math.ceil((cellIndex * cellSize) / pieceSize));
  const max = Math.min(gridLength - 1, Math.ceil(((cellIndex + 1) * cellSize) / pieceSize) - 1);
  return [min, max];
}

// Every grid id a world-grid cell (cx, cy) could contain at solved density
// (a cell holds (WORLD_TILE_SIZE/pieceSize)^2 pieces when solved, see
// config.ts), clipped to the puzzle's actual grid bounds.
export function candidateGridIdsForCell(
  cx: number,
  cy: number,
  cellSize: number,
  gridCols: number,
  gridRows: number,
  pieceSize: number,
): number[] {
  const [colMin, colMax] = ownedRange(cx, cellSize, pieceSize, gridCols);
  const [rowMin, rowMax] = ownedRange(cy, cellSize, pieceSize, gridRows);
  if (colMin > colMax || rowMin > rowMax) return [];
  const out: number[] = [];
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      out.push(row * gridCols + col);
    }
  }
  return out;
}

export class LockedPieceIndex {
  private readonly locked: Uint8Array;

  constructor(
    private readonly gridCols: number,
    private readonly gridRows: number,
    private readonly pieceSize: number,
    private readonly cellSize: number,
    totalPieces: number,
  ) {
    this.locked = new Uint8Array(totalPieces);
  }

  lock(pieceIds: readonly number[]): void {
    for (const id of pieceIds) this.locked[id] = 1;
  }

  isLocked(id: number): boolean {
    return this.locked[id] === 1;
  }

  // Locked grid ids among the candidates of every given cell key. Order is not
  // meaningful; a caller wire-encoding the result does not depend on it.
  collect(cellKeys: Iterable<number>): number[] {
    const out: number[] = [];
    for (const key of cellKeys) {
      const { cx, cy } = unpackCellKey(key);
      const candidates = candidateGridIdsForCell(
        cx,
        cy,
        this.cellSize,
        this.gridCols,
        this.gridRows,
        this.pieceSize,
      );
      for (const id of candidates) {
        if (this.locked[id] === 1) out.push(id);
      }
    }
    return out;
  }

  // Rebuilds the whole bitset from a full piece read (see state.readAllPieces),
  // used at boot, reset, force-complete, and the periodic defense-in-depth
  // resync, the same occasions MinimapGridTracker.rebuildFromBoard runs.
  rebuild(pieces: readonly { id: number; locked: boolean }[]): void {
    this.locked.fill(0);
    for (const p of pieces) {
      if (p.locked) this.locked[p.id] = 1;
    }
  }
}
