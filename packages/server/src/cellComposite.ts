// Server-composited locked-tile geometry and version bookkeeping (see ROADMAP
// Phase 5 Stage 3). "Cell" here is the same shared world-grid cell every other
// per-cell index in this codebase already uses (see worldGrid.ts,
// WORLD_TILE_SIZE), not the minimap's separate downsampled overview grid.

import { cellKey } from "./worldGrid.js";
import { ownedRange } from "./lockedPieces.js";

// Every grid id whose own tile (a pieceSize + 2*margin square centered on its
// canonical cell, the same tile a piece is sliced into) can overlap a cell's
// composite canvas. The canvas itself is widened by margin on every side to
// match an individual piece tile's own bleed, so adjacent cell tiles overlap
// exactly the way individual piece tiles already overlap each other: a piece
// up to one full column/row outside the cell's exact ownership range can
// still bleed a tab into it, since margin is always < pieceSize (see
// DECISIONS: tile margin). Widening the owned range by exactly one piece each
// side is therefore always enough, and never too wide. Over-including a piece
// whose tile happens not to actually reach the canvas is harmless: compositing
// simply clips it.
export function haloGridIdsForCell(
  cx: number,
  cy: number,
  cellSize: number,
  gridCols: number,
  gridRows: number,
  pieceSize: number,
): number[] {
  const [colMin, colMax] = widen(ownedRange(cx, cellSize, pieceSize, gridCols), gridCols - 1);
  const [rowMin, rowMax] = widen(ownedRange(cy, cellSize, pieceSize, gridRows), gridRows - 1);
  if (colMin > colMax || rowMin > rowMax) return [];
  const out: number[] = [];
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      out.push(row * gridCols + col);
    }
  }
  return out;
}

// A range already empty (cell entirely outside the grid) stays empty: there is
// no real piece content to bleed in from a cell that owns nothing itself.
function widen([min, max]: [number, number], hi: number): [number, number] {
  if (min > max) return [min, max];
  return [Math.max(0, min - 1), Math.min(hi, max + 1)];
}

// The world-grid cell that owns a given grid id's canonical position, the same
// cell a locked piece is indexed under everywhere else (broadcast scoping,
// LockedPieceIndex). Used to translate a merge's newly-locked piece ids into
// the cells that need a fresh composite bake.
export function cellKeyForGridId(
  gridId: number,
  gridCols: number,
  pieceSize: number,
  cellSize: number,
): number {
  const col = gridId % gridCols;
  const row = Math.floor(gridId / gridCols);
  return cellKey(
    Math.floor((col * pieceSize) / cellSize),
    Math.floor((row * pieceSize) / cellSize),
  );
}

// Every cell key that owns at least one real piece, across the whole grid.
// Used only by the dev force-complete shortcut, which anchors every remaining
// piece in one call with no per-piece incremental hook to tell us which cells
// actually gained a new lock, so it dirties the lot; a rare, dev-only bulk
// operation; redundantly recompositing an already-complete cell here is an
// acceptable one-off cost.
export function allCellKeysForGrid(
  gridCols: number,
  gridRows: number,
  pieceSize: number,
  cellSize: number,
): number[] {
  const cxMax = Math.floor(((gridCols - 1) * pieceSize) / cellSize);
  const cyMax = Math.floor(((gridRows - 1) * pieceSize) / cellSize);
  const out: number[] = [];
  for (let cy = 0; cy <= cyMax; cy++) {
    const [rowMin, rowMax] = ownedRange(cy, cellSize, pieceSize, gridRows);
    if (rowMin > rowMax) continue;
    for (let cx = 0; cx <= cxMax; cx++) {
      const [colMin, colMax] = ownedRange(cx, cellSize, pieceSize, gridCols);
      if (colMin > colMax) continue;
      out.push(cellKey(cx, cy));
    }
  }
  return out;
}

// In-process read model: each cell's current composite bake version, answering
// "does this cell have a ready composite, and which version" for region_state
// construction. A cell absent here has no bake yet, so a reader falls back to
// per-piece rendering. There is no "permanent" flag: once every piece a cell
// can ever own is locked, no future lock event touches that cell again (see
// cellCompositeVersions in cellCompositor.ts), so its last version simply never
// changes again on its own; force-complete is the one path that revisits an
// already-complete cell anyway (see allCellKeysForGrid).
export class CellCompositeIndex {
  private readonly versions = new Map<number, number>();

  get(key: number): number | undefined {
    return this.versions.get(key);
  }

  set(key: number, version: number): void {
    this.versions.set(key, version);
  }

  clear(): void {
    this.versions.clear();
  }

  // Rebuilds the whole map from persisted state (see state.readCellCompositeVersions),
  // used at boot and after a reset, the same occasions the other per-cell indexes
  // rebuild from Redis (see init.ts).
  rebuild(entries: Iterable<readonly [number, number]>): void {
    this.versions.clear();
    for (const [key, version] of entries) this.versions.set(key, version);
  }
}
