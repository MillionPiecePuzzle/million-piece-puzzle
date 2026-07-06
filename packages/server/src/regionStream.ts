// Chunking and pacing for the region_state viewport resync (see DECISIONS:
// paced region_state batching). Kept pure and dependency-free, like
// worldGrid.ts, so it is unit-testable with no Context/Hub/Redis involved; the
// async send loop that uses this lives in handlers.ts.

import { unpackCellKey, type Aabb } from "./worldGrid.js";

// One batch of entered cells, ready to become a region_state message: a
// world-grid column (cx) range disjoint from every other batch's for the same
// stream, plus the tight world-px bbox of exactly its own cells.
export type CellBatch = { cells: number[]; coverage: Aabb };

type Cell = { key: number; cx: number; cy: number };

// Partitions entered cell keys into batches whose cx (column) ranges never
// overlap another batch's. Columns are walked in ascending cx order and packed
// whole into the current batch up to `batchCells`; a column that alone exceeds
// the budget is sliced into solo sub-batches (by cy) rather than merged with a
// neighbour. This keeps every batch's bounding box safe to mark "known": any
// cell it geometrically spans that is not one of its own cells is guaranteed
// to be either already known to the client from before this stream, or
// outside the viewport, never a same-stream cell deferred to a later,
// not-yet-sent batch. `entered` is assumed non-empty; the caller already
// early-returns on an empty entered set.
export function batchEnteredCells(
  entered: readonly number[],
  cellSize: number,
  batchCells: number,
): CellBatch[] {
  const byColumn = new Map<number, Cell[]>();
  for (const key of entered) {
    const { cx, cy } = unpackCellKey(key);
    let cells = byColumn.get(cx);
    if (!cells) {
      cells = [];
      byColumn.set(cx, cells);
    }
    cells.push({ key, cx, cy });
  }
  for (const cells of byColumn.values()) cells.sort((a, b) => a.cy - b.cy);
  const columns = [...byColumn.keys()].sort((a, b) => a - b);

  const batches: CellBatch[] = [];
  let pending: Cell[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    batches.push({ cells: pending.map((c) => c.key), coverage: boundingBox(pending, cellSize) });
    pending = [];
  };

  for (const cx of columns) {
    const column = byColumn.get(cx)!;
    if (pending.length > 0 && pending.length + column.length > batchCells) flush();
    if (column.length > batchCells) {
      for (let i = 0; i < column.length; i += batchCells) {
        pending = column.slice(i, i + batchCells);
        flush();
      }
      continue;
    }
    pending.push(...column);
  }
  flush();
  return batches;
}

function boundingBox(cells: readonly Cell[], cellSize: number): Aabb {
  let cxMin = Infinity;
  let cxMax = -Infinity;
  let cyMin = Infinity;
  let cyMax = -Infinity;
  for (const c of cells) {
    if (c.cx < cxMin) cxMin = c.cx;
    if (c.cx > cxMax) cxMax = c.cx;
    if (c.cy < cyMin) cyMin = c.cy;
    if (c.cy > cyMax) cyMax = c.cy;
  }
  return {
    minX: cxMin * cellSize,
    minY: cyMin * cellSize,
    maxX: (cxMax + 1) * cellSize,
    maxY: (cyMax + 1) * cellSize,
  };
}

// Real event-loop delay: ws.bufferedAmount only drops between actual ticks, so
// pacing between batches needs a genuine setTimeout, not a microtask.
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
