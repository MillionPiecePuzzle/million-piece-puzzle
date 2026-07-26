// Server-composited locked-tile geometry and version bookkeeping (see ROADMAP
// Phase 5 Stage 3, extended to a multi-level pyramid by Stage 4). "Cell" here
// is the same shared world-grid cell every other per-cell index in this
// codebase already uses (see worldGrid.ts, WORLD_TILE_SIZE), not the
// minimap's separate downsampled overview grid.

import type { CellComposite } from "@mpp/shared";
import { cellKey, unpackCellKey } from "./worldGrid.js";
import { ownedRange } from "./lockedPieces.js";

// The pyramid builds levels 0 (this file's existing per-piece bake) through
// this constant (see ROADMAP Phase 5 Stage 4): level 3 already covers only
// 1/25 of the board, so no level is ever small enough to need a broadcast
// tier different from level 0's own viewport scoping.
export const MAX_CELL_COMPOSITE_LEVEL = 3;

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

// The cell one pyramid level up that owns a given cell, in the parent's own
// coordinate space (see ROADMAP Phase 5 Stage 4): halving is scale-invariant,
// so the same step works starting from any level's (cx, cy), not just level
// 0's; a level L>=1 cell's own children live one level down at (2cx, 2cy),
// (2cx+1, 2cy), (2cx, 2cy+1), (2cx+1, 2cy+1).
export function parentCellKey(cx: number, cy: number): number {
  return cellKey(Math.floor(cx / 2), Math.floor(cy / 2));
}

// A level-0 cell key's ancestor `levels` pyramid levels up, by walking
// parentCellKey repeatedly (halving is scale-invariant, so each step works
// starting from the previous step's own (cx, cy), the same way parentCellKey
// itself does at any single level). `levels === 0` returns the key unchanged.
export function ancestorCellKey(key0: number, levels: number): number {
  let key = key0;
  for (let i = 0; i < levels; i++) {
    const { cx, cy } = unpackCellKey(key);
    key = parentCellKey(cx, cy);
  }
  return key;
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

// In-process read model: each cell's current composite bake version at each
// pyramid level, answering "does this cell have a ready composite, and which
// version" for region_state construction and for a level L>=1 bake's own read
// of its level L-1 children. A cell absent at its level has no bake yet, so a
// reader falls back (the client to a finer already-ready level, or to simply
// omitting that child at level>=1 here on the server). There is no
// "permanent" flag: once every piece a
// cell can ever own is locked, no future lock event touches that cell (or,
// transitively, its ancestors) again (see cellCompositeVersions in
// cellCompositor.ts), so its last version simply never changes again on its
// own; force-complete is the one path that revisits an already-complete cell
// anyway (see allCellKeysForGrid). Levels are namespaced by a separate Map per
// level rather than one combined key, since the same (cx, cy) pair, and so the
// same packed cellKey, recurs at every level.
export class CellCompositeIndex {
  private readonly versions = new Map<number, Map<number, number>>();

  get(level: number, key: number): number | undefined {
    return this.versions.get(level)?.get(key);
  }

  set(level: number, key: number, version: number): void {
    let m = this.versions.get(level);
    if (!m) {
      m = new Map();
      this.versions.set(level, m);
    }
    m.set(key, version);
  }

  clear(): void {
    this.versions.clear();
  }

  // Rebuilds one level's map from persisted state (see
  // state.readCellCompositeVersions), used at boot and after a reset, the same
  // occasions the other per-cell indexes rebuild from Redis (see init.ts),
  // called once per level 0..MAX_CELL_COMPOSITE_LEVEL.
  rebuild(level: number, entries: Iterable<readonly [number, number]>): void {
    const m = new Map<number, number>();
    for (const [key, version] of entries) m.set(key, version);
    this.versions.set(level, m);
  }
}

// Every composited tile, at any pyramid level 0..maxLevel, covering a
// region_state batch's level-0 cells (see ROADMAP Phase 5 Stage 5). Level 0
// entries are the batch's own cells as-is; a level L>=1 entry is their
// ancestor at that level, deduped so several of the batch's cells sharing the
// same higher-level ancestor emit it only once. A (level, key) with no bake
// yet in `index` is simply omitted, the same "absent means not ready yet"
// convention region_state already uses for lockedPieceIds.
export function collectRegionCellComposites(
  index: CellCompositeIndex,
  level0Keys: readonly number[],
  maxLevel: number,
): CellComposite[] {
  const out: CellComposite[] = [];
  for (let level = 0; level <= maxLevel; level++) {
    const seen = new Set<number>();
    for (const key0 of level0Keys) {
      const key = ancestorCellKey(key0, level);
      if (seen.has(key)) continue;
      seen.add(key);
      const version = index.get(level, key);
      if (version !== undefined) out.push({ cellKey: key, level, version });
    }
  }
  return out;
}
