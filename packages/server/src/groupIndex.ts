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
// The cell key is derived from the body top-left, but the reported payload is the
// group ORIGIN (plus its size): a client positions a group's container at the
// origin and places each piece at its canonical offset inside, so `collect`
// reports the origin while keying still uses the body-min the client sees. The
// viewport handler turns this into the region_state construction stream. The body
// rectangle itself is kept alongside, which is what lets `overlapsBox` answer
// where a cluster can land without re-reading Redis.

import { cellKey, type Aabb } from "./worldGrid.js";

// Reportable payload for a group: its origin (what the client positions the
// container at), its member count, and the extent of the body whose top-left the
// index is keyed on, which is what turns a cell hit into the real rectangle a
// group occupies (see overlapsBox). A live group is never locked (see DECISIONS:
// locked pieces stop being a group; LockedPieceIndex answers locked-piece queries
// separately), so this index carries no locked field.
export type GroupPayload = {
  originX: number;
  originY: number;
  size: number;
  width: number;
  height: number;
};

type IndexedGroup = {
  cell: number;
  bodyMinX: number;
  bodyMinY: number;
  originX: number;
  originY: number;
  size: number;
  width: number;
  height: number;
};

export type RegionGroup = {
  groupId: number;
  worldX: number;
  worldY: number;
  size: number;
};

// A group whose body rectangle contains a queried point. The origin comes with
// it because that is what turns the point into the piece of that group standing
// there: local = point - origin, and the grid is regular in solved space.
export type CoveringGroup = {
  groupId: number;
  originX: number;
  originY: number;
};

export class GroupIndex {
  private readonly cells = new Map<number, Set<number>>();
  private readonly groups = new Map<number, IndexedGroup>();
  // Largest body extent ever indexed, in world units. A box query starts this far
  // back so a cluster reaching into the box from a cell up or left of it is still
  // walked (a group sits in the cell of its top-left corner only). Monotonic: a
  // merge that removes the widest cluster leaves the bound behind, which costs an
  // over-wide walk and never a miss.
  private maxWidth = 0;
  private maxHeight = 0;

  constructor(private readonly cellSize: number) {}

  private cellFor(worldX: number, worldY: number): number {
    return cellKey(Math.floor(worldX / this.cellSize), Math.floor(worldY / this.cellSize));
  }

  // Insert or move a group keyed by the cell containing (bodyMinX, bodyMinY), its
  // body top-left, while storing that corner, the reported payload (origin, size)
  // and the body extent. Idempotent: re-setting the same cell only refreshes the
  // stored values, so the per-frame drop path stays cheap.
  set(groupId: number, bodyMinX: number, bodyMinY: number, payload: GroupPayload): void {
    const cell = this.cellFor(bodyMinX, bodyMinY);
    if (payload.width > this.maxWidth) this.maxWidth = payload.width;
    if (payload.height > this.maxHeight) this.maxHeight = payload.height;
    const existing = this.groups.get(groupId);
    if (existing) {
      if (existing.cell !== cell) {
        this.removeFromCell(existing.cell, groupId);
        this.addToCell(cell, groupId);
        existing.cell = cell;
      }
      existing.bodyMinX = bodyMinX;
      existing.bodyMinY = bodyMinY;
      existing.originX = payload.originX;
      existing.originY = payload.originY;
      existing.size = payload.size;
      existing.width = payload.width;
      existing.height = payload.height;
      return;
    }
    this.addToCell(cell, groupId);
    this.groups.set(groupId, { cell, bodyMinX, bodyMinY, ...payload });
  }

  remove(groupId: number): void {
    const g = this.groups.get(groupId);
    if (!g) return;
    this.removeFromCell(g.cell, groupId);
    this.groups.delete(groupId);
  }

  // Reportable state (origin, size) of every group sitting in any of the given
  // cells. Each group lives in exactly one cell, so distinct cells yield
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
          });
        }
      }
    }
    return out;
  }

  // Total member count of the groups resting in the cell of (bodyMinX, bodyMinY),
  // excluding one group (the one being dropped, which may already be indexed in
  // that cell when it is not changing cells). Drives the per-tile piece cap.
  cellPieceCount(bodyMinX: number, bodyMinY: number, excludeGroupId: number): number {
    const set = this.cells.get(this.cellFor(bodyMinX, bodyMinY));
    if (!set) return 0;
    let total = 0;
    for (const id of set) {
      if (id === excludeGroupId) continue;
      total += this.groups.get(id)?.size ?? 0;
    }
    return total;
  }

  // Whether any group other than `exceptGroupId` occupies the given world box.
  // Answers the server-side landing search for a cluster dropped on a flag (see
  // dropNear.ts), which is why it walks the real body rectangles rather than
  // stopping at cell granularity.
  overlapsBox(box: Aabb, exceptGroupId: number): boolean {
    const cxMin = Math.floor((box.minX - this.maxWidth) / this.cellSize);
    const cxMax = Math.floor(box.maxX / this.cellSize);
    const cyMin = Math.floor((box.minY - this.maxHeight) / this.cellSize);
    const cyMax = Math.floor(box.maxY / this.cellSize);
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        const set = this.cells.get(cellKey(cx, cy));
        if (!set) continue;
        for (const id of set) {
          if (id === exceptGroupId) continue;
          const g = this.groups.get(id);
          if (g && bodyOverlaps(g, box)) return true;
        }
      }
    }
    return false;
  }

  // Groups whose body rectangle contains a world point, capped at `limit` and
  // skipping the ids in `except`. A body is a bounding box, so a hit only means
  // the group may have a piece there: the caller resolves that (see snap.ts).
  // Stopping at `limit` can therefore undercount when candidates turn out not to
  // cover the point after all, which only ever lets a snap through, never blocks
  // one, and never happens to the pile this bounds (stacked singletons, whose
  // body is the piece itself).
  groupsCoveringPoint(
    x: number,
    y: number,
    except: ReadonlySet<number>,
    limit: number,
  ): CoveringGroup[] {
    const out: CoveringGroup[] = [];
    if (limit <= 0) return out;
    const cxMin = Math.floor((x - this.maxWidth) / this.cellSize);
    const cxMax = Math.floor(x / this.cellSize);
    const cyMin = Math.floor((y - this.maxHeight) / this.cellSize);
    const cyMax = Math.floor(y / this.cellSize);
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        const set = this.cells.get(cellKey(cx, cy));
        if (!set) continue;
        for (const id of set) {
          if (except.has(id)) continue;
          const g = this.groups.get(id);
          if (!g || !bodyContainsPoint(g, x, y)) continue;
          out.push({ groupId: id, originX: g.originX, originY: g.originY });
          if (out.length === limit) return out;
        }
      }
    }
    return out;
  }

  clear(): void {
    this.cells.clear();
    this.groups.clear();
    this.maxWidth = 0;
    this.maxHeight = 0;
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

// Edge contact does not count, matching the client's own overlap test: a cluster
// resting exactly against another is clear of it.
function bodyOverlaps(g: IndexedGroup, box: Aabb): boolean {
  return (
    g.bodyMinX < box.maxX &&
    g.bodyMinX + g.width > box.minX &&
    g.bodyMinY < box.maxY &&
    g.bodyMinY + g.height > box.minY
  );
}

function bodyContainsPoint(g: IndexedGroup, x: number, y: number): boolean {
  return (
    x >= g.bodyMinX && x < g.bodyMinX + g.width && y >= g.bodyMinY && y < g.bodyMinY + g.height
  );
}
