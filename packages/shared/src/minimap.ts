// A downsampled density grid of the whole board for the minimap overview. Each
// cell carries the count of loose and locked pieces whose body center falls in
// it, row-major over cols*rows cells. The contributor renders this global
// overview decoupled from its (now partial) local board. Cells are roughly
// square, with the larger play-zone axis split into MINIMAP_TARGET_CELLS.

import type { GroupRuntime } from "./piece.js";
import type { PlayZone } from "./playzone.js";

// Minimal internal piece shape this binner needs. It runs server-side over grid
// ids and group origins (never the seed-permuted wire ids), so it takes only the
// id and groupId, decoupled from WirePiece's anchor-relative (dx, dy). A locked
// piece has no live group (see DECISIONS: locked pieces stop being a group), so
// locked state is carried on the piece itself, not resolved through groupId.
type GridPiece = { id: number; groupId: number; locked: boolean };

export type MinimapGrid = {
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  cellW: number;
  cellH: number;
  // Per-cell piece counts, row-major (index = row * cols + col), each cols*rows long.
  loose: number[];
  locked: number[];
};

const MINIMAP_TARGET_CELLS = 96;

type GridDimensions = {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
};

function gridDimensionsFor(playZone: PlayZone): GridDimensions {
  const zoneW = Math.max(1, playZone.maxX - playZone.minX);
  const zoneH = Math.max(1, playZone.maxY - playZone.minY);
  const cell = Math.max(zoneW, zoneH) / MINIMAP_TARGET_CELLS;
  const cols = Math.max(1, Math.round(zoneW / cell));
  const rows = Math.max(1, Math.round(zoneH / cell));
  return { cols, rows, cellW: zoneW / cols, cellH: zoneH / rows };
}

// The one place a piece's grid cell is computed from its id and its group's
// live origin. Both the from-scratch build below and MinimapGridTracker's
// incremental update call this, so they can never quietly disagree on the math.
// A piece references its group for the live origin; its solved cell (id % cols,
// id / cols) gives the body offset, so the world center is origin + offset + half.
function cellIndexForPiece(
  pieceId: number,
  originX: number,
  originY: number,
  gridCols: number,
  pieceSize: number,
  playZone: PlayZone,
  dims: GridDimensions,
): number {
  const half = pieceSize / 2;
  const wx = originX + (pieceId % gridCols) * pieceSize + half;
  const wy = originY + Math.floor(pieceId / gridCols) * pieceSize + half;
  let cx = Math.floor((wx - playZone.minX) / dims.cellW);
  let cy = Math.floor((wy - playZone.minY) / dims.cellH);
  if (cx < 0) cx = 0;
  else if (cx >= dims.cols) cx = dims.cols - 1;
  if (cy < 0) cy = 0;
  else if (cy >= dims.rows) cy = dims.rows - 1;
  return cy * dims.cols + cx;
}

// Bins every piece into a play-zone-aligned grid by its body center, splitting
// loose from locked so the map reads progress. Pure and O(board): the only
// caller is MinimapGridTracker.rebuildFromBoard (boot, reset, force-complete,
// and the slow defense-in-depth resync), never the per-drop hot path.
export function buildMinimapGrid(
  pieces: readonly GridPiece[],
  groups: readonly GroupRuntime[],
  gridCols: number,
  pieceSize: number,
  playZone: PlayZone,
): MinimapGrid {
  const dims = gridDimensionsFor(playZone);
  const loose = new Array<number>(dims.cols * dims.rows).fill(0);
  const locked = new Array<number>(dims.cols * dims.rows).fill(0);
  const groupById = new Map<number, GroupRuntime>();
  for (const g of groups) groupById.set(g.id, g);
  for (const p of pieces) {
    // A locked piece has no group: its position is its own canonical solved
    // cell, the same origin-(0,0) convention a freshly anchored group used
    // before it was ever persisted (see wire.ts: anchorWorldX at origin 0
    // is a piece's true solved position).
    if (p.locked) {
      const idx = cellIndexForPiece(p.id, 0, 0, gridCols, pieceSize, playZone, dims);
      locked[idx] = locked[idx]! + 1;
      continue;
    }
    const g = groupById.get(p.groupId);
    if (!g) continue;
    const idx = cellIndexForPiece(p.id, g.worldX, g.worldY, gridCols, pieceSize, playZone, dims);
    loose[idx] = loose[idx]! + 1;
  }
  return {
    cols: dims.cols,
    rows: dims.rows,
    originX: playZone.minX,
    originY: playZone.minY,
    cellW: dims.cellW,
    cellH: dims.cellH,
    loose,
    locked,
  };
}

// A group's resting state as far as the grid cares: where its pieces are, and
// which bucket (loose/locked) they count in.
export type GroupPositionState = {
  originX: number;
  originY: number;
  locked: boolean;
};

// Incrementally-maintained twin of buildMinimapGrid's output. A full rebuild
// (rebuildFromBoard) is the only source of truth for the counts, paid once at
// boot/reset/force-complete and on a slow periodic resync; every drop or anchor
// in between calls applyTranslation instead of re-scanning the board, moving
// only the pieces of the one group that actually moved. Both paths share
// cellIndexForPiece, so an incremental update can never drift from what a full
// recompute would say about the same board state.
export class MinimapGridTracker {
  private dims: GridDimensions;
  private loose: number[];
  private locked: number[];

  constructor(
    private readonly gridCols: number,
    private readonly pieceSize: number,
    private readonly playZone: PlayZone,
  ) {
    this.dims = gridDimensionsFor(playZone);
    this.loose = new Array<number>(this.dims.cols * this.dims.rows).fill(0);
    this.locked = new Array<number>(this.dims.cols * this.dims.rows).fill(0);
  }

  // O(board): overwrites the live counts with a from-scratch recompute. Meant
  // for boot, reset, force-complete, and the periodic resync, never the per-drop
  // hot path.
  rebuildFromBoard(pieces: readonly GridPiece[], groups: readonly GroupRuntime[]): void {
    const grid = buildMinimapGrid(pieces, groups, this.gridCols, this.pieceSize, this.playZone);
    this.dims = { cols: grid.cols, rows: grid.rows, cellW: grid.cellW, cellH: grid.cellH };
    this.loose = grid.loose;
    this.locked = grid.locked;
  }

  // Moves one group's own pieces from their old resting state to their new one.
  // O(pieceIds): the size of the group being dropped or merged, never the board,
  // since the caller already holds this exact piece list to run detectSnap or
  // the merge itself. A no-op when neither the origin nor the lock bucket
  // actually changed (e.g. the stationary side of a merge).
  applyTranslation(
    pieceIds: readonly number[],
    from: GroupPositionState,
    to: GroupPositionState,
  ): void {
    if (from.originX === to.originX && from.originY === to.originY && from.locked === to.locked) {
      return;
    }
    const fromBucket = from.locked ? this.locked : this.loose;
    const toBucket = to.locked ? this.locked : this.loose;
    for (const id of pieceIds) {
      const oldIdx = cellIndexForPiece(
        id,
        from.originX,
        from.originY,
        this.gridCols,
        this.pieceSize,
        this.playZone,
        this.dims,
      );
      const newIdx = cellIndexForPiece(
        id,
        to.originX,
        to.originY,
        this.gridCols,
        this.pieceSize,
        this.playZone,
        this.dims,
      );
      fromBucket[oldIdx] = fromBucket[oldIdx]! - 1;
      toBucket[newIdx] = toBucket[newIdx]! + 1;
    }
  }

  // A defensive copy: the caller (a WS broadcast payload) must not hold a
  // reference that keeps mutating underneath it.
  snapshot(): MinimapGrid {
    return {
      cols: this.dims.cols,
      rows: this.dims.rows,
      originX: this.playZone.minX,
      originY: this.playZone.minY,
      cellW: this.dims.cellW,
      cellH: this.dims.cellH,
      loose: [...this.loose],
      locked: [...this.locked],
    };
  }
}
