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

import { cellKey } from "./worldGrid.js";

export type GroupPosition = { groupId: number; worldX: number; worldY: number };

export class GroupIndex {
  private readonly cells = new Map<number, Set<number>>();
  private readonly groups = new Map<number, { x: number; y: number; cell: number }>();

  constructor(private readonly cellSize: number) {}

  private cellFor(worldX: number, worldY: number): number {
    return cellKey(Math.floor(worldX / this.cellSize), Math.floor(worldY / this.cellSize));
  }

  // Insert or move a group to the cell containing (worldX, worldY), its body
  // top-left. Idempotent: re-setting the same cell only refreshes the stored
  // position, so the per-frame drop path stays cheap.
  set(groupId: number, worldX: number, worldY: number): void {
    const cell = this.cellFor(worldX, worldY);
    const existing = this.groups.get(groupId);
    if (existing) {
      if (existing.cell !== cell) {
        this.removeFromCell(existing.cell, groupId);
        this.addToCell(cell, groupId);
        existing.cell = cell;
      }
      existing.x = worldX;
      existing.y = worldY;
      return;
    }
    this.addToCell(cell, groupId);
    this.groups.set(groupId, { x: worldX, y: worldY, cell });
  }

  remove(groupId: number): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    this.removeFromCell(g.cell, groupId);
    this.groups.delete(groupId);
  }

  // Current positions of every group sitting in any of the given cells. Each
  // group lives in exactly one cell, so distinct cells yield disjoint groups (no
  // dedup needed). Used to build the resync for a client's newly entered cells.
  collect(cellKeys: Iterable<number>): GroupPosition[] {
    const out: GroupPosition[] = [];
    for (const key of cellKeys) {
      const set = this.cells.get(key);
      if (!set) continue;
      for (const groupId of set) {
        const g = this.groups.get(groupId);
        if (g) out.push({ groupId, worldX: g.x, worldY: g.y });
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
