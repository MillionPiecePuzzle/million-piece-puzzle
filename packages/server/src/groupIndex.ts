// In-process spatial index of every group's current resting position, keyed on
// the same world grid as the broadcast index. The broadcast index answers "which
// clients overlap this event"; this answers "which groups sit in these cells",
// for the pan resync: when a client's viewport enters new cells, the server hands
// it the current positions of the groups there so it picks up non-merging drops
// it missed while looking elsewhere (those drops are scoped, never persisted).
//
// Single-writer topology, so this lives in process memory (like the dispatch
// queues, the IP registry and the broadcast index), not Redis. Redis stays the
// source of truth for positions; this is a read model rebuilt from Redis at boot
// and on reset. It duplicates each group's position so the resync gather is a
// pure in-memory read, never a per-pan Redis scan.
//
// Each group occupies exactly one cell, the cell of its body top-left (the world
// AABB min, where the client actually sees it, not the group origin which sits a
// canonical offset away). So the index holds one entry per group: ~1M at the
// start (each piece its own group) and shrinking with every merge. A cluster
// straddling a cell boundary is indexed only by its min-corner cell; its live
// drops still reach every overlapped cell through the broadcast index, and a
// continued pan or its next drop heals the residual.
//
// The cell key is derived from the body top-left, but the stored payload is the
// group ORIGIN (plus its size and locked state): a client positions a group's
// container at the origin and places each piece at its canonical offset inside,
// so `collect` reports the origin while keying still uses the body-min the client
// sees. The viewport handler turns this into the region_state construction stream.

import { cellKey } from "./worldGrid.js";

// Reportable payload for a group: its origin (what the client positions the
// container at), its member count, and whether it is locked.
export type GroupPayload = { originX: number; originY: number; size: number; locked: boolean };

export type RegionGroup = {
  groupId: number;
  worldX: number;
  worldY: number;
  size: number;
  locked: boolean;
};

export class GroupIndex {
  private readonly cells = new Map<number, Set<number>>();
  private readonly groups = new Map<
    number,
    { cell: number; originX: number; originY: number; size: number; locked: boolean }
  >();

  constructor(private readonly cellSize: number) {}

  private cellFor(worldX: number, worldY: number): number {
    return cellKey(Math.floor(worldX / this.cellSize), Math.floor(worldY / this.cellSize));
  }

  // Insert or move a group keyed by the cell containing (bodyMinX, bodyMinY), its
  // body top-left, while storing the reportable payload (origin, size, locked).
  // Idempotent: re-setting the same cell only refreshes the payload, so the
  // per-frame drop path stays cheap.
  set(groupId: number, bodyMinX: number, bodyMinY: number, payload: GroupPayload): void {
    const cell = this.cellFor(bodyMinX, bodyMinY);
    const existing = this.groups.get(groupId);
    if (existing) {
      if (existing.cell !== cell) {
        this.removeFromCell(existing.cell, groupId);
        this.addToCell(cell, groupId);
        existing.cell = cell;
      }
      existing.originX = payload.originX;
      existing.originY = payload.originY;
      existing.size = payload.size;
      existing.locked = payload.locked;
      return;
    }
    this.addToCell(cell, groupId);
    this.groups.set(groupId, { cell, ...payload });
  }

  remove(groupId: number): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    this.removeFromCell(g.cell, groupId);
    this.groups.delete(groupId);
  }

  // Reportable state (origin, size, locked) of every group sitting in any of the
  // given cells. Each group lives in exactly one cell, so distinct cells yield
  // disjoint groups (no dedup needed). The viewport handler attaches piece ids to
  // build the region_state construction stream for a client's newly entered cells.
  collect(cellKeys: Iterable<number>): RegionGroup[] {
    const out: RegionGroup[] = [];
    for (const key of cellKeys) {
      const set = this.cells.get(key);
      if (!set) continue;
      for (const groupId of set) {
        const g = this.groups.get(groupId);
        if (g) {
          out.push({
            groupId,
            worldX: g.originX,
            worldY: g.originY,
            size: g.size,
            locked: g.locked,
          });
        }
      }
    }
    return out;
  }

  clear(): void {
    this.cells.clear();
    this.groups.clear();
  }

  get size(): number {
    return this.groups.size;
  }

  // The cell a group currently sits in, or undefined when it is not indexed.
  // Exposed for tests asserting index maintenance.
  cellOf(groupId: number): number | undefined {
    return this.groups.get(groupId)?.cell;
  }

  private addToCell(cell: number, groupId: number): void {
    let set = this.cells.get(cell);
    if (!set) {
      set = new Set();
      this.cells.set(cell, set);
    }
    set.add(groupId);
  }

  private removeFromCell(cell: number, groupId: number): void {
    const set = this.cells.get(cell);
    if (!set) return;
    set.delete(groupId);
    if (set.size === 0) this.cells.delete(cell);
  }
}
