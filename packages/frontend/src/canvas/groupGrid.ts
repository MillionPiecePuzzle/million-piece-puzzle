// Spatial hash over a fixed square grid, kept free of Pixi so the index can be
// unit tested in isolation. It maps a group to the grid cells its world AABB
// spans and back, so a viewport query touches only nearby cells instead of every
// group, and a tile bake can ask for exactly the groups overlapping one cell.
// The grid pitch is the LOD tile size, so a cell key is also a tile key.

import { WORLD_TILE_SIZE } from "@mpp/shared";
import type { Aabb } from "./cull";

// World-space grid cell, and the on-screen tile, share this size: one cell maps
// to one zoom-out LOD tile, so a group's cells are exactly the tiles it occupies.
// It is the shared world grid pitch, the same cell the server scopes broadcasts
// on and measures the per-tile piece cap over, so the tile the client sees is the
// region the server checks.
export const LOD_TILE_WORLD = WORLD_TILE_SIZE;

// Packed (cx, cy) cell coordinate. Cell coordinates are biased into the
// non-negative range and interleaved, so the pack is a bijection for
// |cx|, |cy| < 32768, which the alpha and 1M boards both stay well within.
export type CellKey = number;
const CELL_BIAS = 1 << 15;
const CELL_SPAN = 1 << 16;

export function packCell(cx: number, cy: number): CellKey {
  return (cx + CELL_BIAS) * CELL_SPAN + (cy + CELL_BIAS);
}

export function unpackCell(key: CellKey): { cx: number; cy: number } {
  const cy = (key % CELL_SPAN) - CELL_BIAS;
  const cx = Math.floor(key / CELL_SPAN) - CELL_BIAS;
  return { cx, cy };
}

// The server packs the same world-grid cell coordinate independently, with a
// different bit layout (see packages/server/src/worldGrid.ts's cellKey): only
// the underlying (cx, cy) pair is meant to cross the wire, not either side's
// packed key. This mirrors the server's encoding so a wire
// CellComposite.cellKey can be translated into this module's own CellKey
// (via packCell) for lookups against groupGrid-keyed state.
const WIRE_CELL_KEY_BITS = 24;
const WIRE_CELL_KEY_HALF = 1 << (WIRE_CELL_KEY_BITS - 1);
const WIRE_CELL_KEY_STRIDE = 1 << WIRE_CELL_KEY_BITS;
export function unpackWireCellKey(key: number): { cx: number; cy: number } {
  const cx = Math.floor(key / WIRE_CELL_KEY_STRIDE) - WIRE_CELL_KEY_HALF;
  const cy = (key % WIRE_CELL_KEY_STRIDE) - WIRE_CELL_KEY_HALF;
  return { cx, cy };
}

// Cell keys of every cell a world AABB touches, max edge inclusive (a box
// resting exactly on a cell line counts as touching both neighbours, which keeps
// registration and query symmetric so an overlap is never missed).
export function cellKeysForRect(box: Aabb, cell: number): CellKey[] {
  const cx0 = Math.floor(box.minX / cell);
  const cx1 = Math.floor(box.maxX / cell);
  const cy0 = Math.floor(box.minY / cell);
  const cy1 = Math.floor(box.maxY / cell);
  const keys: CellKey[] = [];
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) keys.push(packCell(cx, cy));
  }
  return keys;
}

export class GroupGrid {
  private readonly cell: number;
  private readonly cells = new Map<CellKey, Set<number>>();
  private readonly groupCells = new Map<number, CellKey[]>();

  constructor(cellSize: number) {
    this.cell = cellSize;
  }

  // Re-index a group to the cells its world AABB now spans. A no-op when the
  // cell set is unchanged, so a slow drag that stays within one cell does not
  // churn the index every frame.
  upsert(id: number, box: Aabb): void {
    const next = cellKeysForRect(box, this.cell);
    const prev = this.groupCells.get(id);
    if (prev && sameKeys(prev, next)) return;
    if (prev) this.detach(id, prev);
    for (const key of next) {
      let set = this.cells.get(key);
      if (!set) {
        set = new Set();
        this.cells.set(key, set);
      }
      set.add(id);
    }
    this.groupCells.set(id, next);
  }

  remove(id: number): void {
    const prev = this.groupCells.get(id);
    if (!prev) return;
    this.detach(id, prev);
    this.groupCells.delete(id);
  }

  // Every group registered in any cell the box touches, deduped across cells.
  // Over-inclusive at cell granularity: the caller refines with a precise test.
  queryRect(box: Aabb): Set<number> {
    const out = new Set<number>();
    for (const key of cellKeysForRect(box, this.cell)) {
      const set = this.cells.get(key);
      if (!set) continue;
      for (const id of set) out.add(id);
    }
    return out;
  }

  // Groups overlapping exactly one cell (one tile), for the per-tile bake.
  cellGroups(key: CellKey): ReadonlySet<number> | undefined {
    return this.cells.get(key);
  }

  // Cells a group occupies, for "are all my tiles ready" gapless-fill checks.
  cellsOf(id: number): readonly CellKey[] {
    return this.groupCells.get(id) ?? EMPTY;
  }

  clear(): void {
    this.cells.clear();
    this.groupCells.clear();
  }

  private detach(id: number, keys: readonly CellKey[]): void {
    for (const key of keys) {
      const set = this.cells.get(key);
      if (!set) continue;
      set.delete(id);
      if (set.size === 0) this.cells.delete(key);
    }
  }
}

const EMPTY: readonly CellKey[] = [];

function sameKeys(a: readonly CellKey[], b: readonly CellKey[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
