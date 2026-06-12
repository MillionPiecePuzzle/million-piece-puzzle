import type { Redis } from "ioredis";
import type { GroupRuntime } from "@mpp/shared";
import * as keys from "./redis/keys.js";
import type { Aabb } from "./worldGrid.js";

// A piece as stored server-side: grid id, its group id, and rotation. The wire
// PieceRuntime additionally carries the (dx, dy) anchor offset, attached only at
// the wire boundary (see wire.ts); the internal model never needs it.
export type StoredPiece = { id: number; groupId: number; rotation: number };

// A group as stored server-side: the wire `GroupRuntime` plus its group-local
// AABB (relative to the origin), persisted so the drag hot path scopes by the
// cluster's full extent without a per-frame piece scan. `localAabb` is null for a
// group written before AABBs were stored (caller falls back to point scoping).
// The AABB never crosses the wire: `readAllGroups` (state + keyframe) returns
// plain `GroupRuntime`.
export type StoredGroup = GroupRuntime & { localAabb: Aabb | null };

export type PuzzleMeta = {
  totalPieces: number;
  gridRows: number;
  gridCols: number;
  pieceSize: number;
  snapTolerance: number;
  generationSeed: string;
  status: "active" | "completed";
  startedAt: number;
};

function parseGroup(id: number, h: Record<string, string>): GroupRuntime | null {
  if (!h.size) return null;
  return {
    id,
    worldX: Number(h.worldX),
    worldY: Number(h.worldY),
    locked: h.locked === "1",
    size: Number(h.size),
    heldBy: h.heldBy === "" || h.heldBy === undefined ? null : h.heldBy,
  };
}

function parseLocalAabb(h: Record<string, string>): Aabb | null {
  if (h.aabbMinX === undefined) return null;
  return {
    minX: Number(h.aabbMinX),
    minY: Number(h.aabbMinY),
    maxX: Number(h.aabbMaxX),
    maxY: Number(h.aabbMaxY),
  };
}

function parsePiece(id: number, h: Record<string, string>): StoredPiece {
  return {
    id,
    groupId: Number(h.groupId),
    rotation: Number(h.rotation),
  };
}

export class RedisState {
  constructor(
    private readonly r: Redis,
    private readonly puzzleId: string,
  ) {}

  get currentPuzzleId(): string {
    return this.puzzleId;
  }

  async hasMeta(): Promise<boolean> {
    return (await this.r.exists(keys.puzzleMeta(this.puzzleId))) === 1;
  }

  async wipePuzzle(totalPieces: number): Promise<void> {
    const pipe = this.r.pipeline();
    pipe.del(keys.puzzleMeta(this.puzzleId));
    pipe.del(keys.lockedCount(this.puzzleId));
    pipe.del(keys.presence(this.puzzleId));
    for (let i = 0; i < totalPieces; i++) {
      pipe.del(
        keys.piece(this.puzzleId, i),
        keys.group(this.puzzleId, i),
        keys.groupPieces(this.puzzleId, i),
      );
    }
    await pipe.exec();
  }

  async writeMeta(meta: PuzzleMeta): Promise<void> {
    await this.r.hset(keys.puzzleMeta(this.puzzleId), {
      totalPieces: meta.totalPieces,
      gridRows: meta.gridRows,
      gridCols: meta.gridCols,
      pieceSize: meta.pieceSize,
      snapTolerance: meta.snapTolerance,
      generationSeed: meta.generationSeed,
      status: meta.status,
      startedAt: meta.startedAt,
    });
  }

  async readMeta(): Promise<PuzzleMeta> {
    const h = await this.r.hgetall(keys.puzzleMeta(this.puzzleId));
    return {
      totalPieces: Number(h.totalPieces),
      gridRows: Number(h.gridRows),
      gridCols: Number(h.gridCols),
      pieceSize: Number(h.pieceSize),
      snapTolerance: Number(h.snapTolerance),
      generationSeed: h.generationSeed ?? "",
      status: h.status as PuzzleMeta["status"],
      startedAt: Number(h.startedAt),
    };
  }

  async setPieceGroup(id: number, groupId: number): Promise<void> {
    await this.r.hset(keys.piece(this.puzzleId, id), "groupId", groupId);
  }

  async readPieceGroup(id: number): Promise<number | null> {
    const v = await this.r.hget(keys.piece(this.puzzleId, id), "groupId");
    return v === null ? null : Number(v);
  }

  async writeGroup(g: StoredGroup): Promise<void> {
    const fields: Record<string, string | number> = {
      worldX: g.worldX,
      worldY: g.worldY,
      locked: g.locked ? 1 : 0,
      size: g.size,
      heldBy: g.heldBy ?? "",
    };
    if (g.localAabb) {
      fields.aabbMinX = g.localAabb.minX;
      fields.aabbMinY = g.localAabb.minY;
      fields.aabbMaxX = g.localAabb.maxX;
      fields.aabbMaxY = g.localAabb.maxY;
    }
    await this.r.hset(keys.group(this.puzzleId, g.id), fields);
  }

  async readGroup(id: number): Promise<StoredGroup | null> {
    const h = await this.r.hgetall(keys.group(this.puzzleId, id));
    const g = parseGroup(id, h);
    if (!g) return null;
    return { ...g, localAabb: parseLocalAabb(h) };
  }

  async deleteGroup(id: number): Promise<void> {
    await this.r.del(keys.group(this.puzzleId, id), keys.groupPieces(this.puzzleId, id));
  }

  async setGroupPosition(id: number, worldX: number, worldY: number): Promise<void> {
    await this.r.hset(keys.group(this.puzzleId, id), { worldX, worldY });
  }

  async tryAcquireGroup(id: number, userId: string): Promise<string | null> {
    const key = keys.group(this.puzzleId, id);
    // 'size' marks a fully written group (see parseGroup); reject acquiring a
    // group id that has no group instead of creating a bare heldBy hash.
    const lua = `
      if redis.call('HEXISTS', KEYS[1], 'size') == 0 then return 'MISSING' end
      local locked = redis.call('HGET', KEYS[1], 'locked')
      if locked == '1' then return 'LOCKED' end
      local current = redis.call('HGET', KEYS[1], 'heldBy')
      if current and current ~= '' then return current end
      redis.call('HSET', KEYS[1], 'heldBy', ARGV[1])
      return ''
    `;
    const result = (await this.r.eval(lua, 1, key, userId)) as string;
    return result === "" ? null : result;
  }

  async releaseGroup(id: number): Promise<void> {
    await this.r.hset(keys.group(this.puzzleId, id), "heldBy", "");
  }

  async writeInitialPieces(
    entries: { pieceId: number; group: GroupRuntime; localAabb: Aabb }[],
  ): Promise<void> {
    const CHUNK = 1000;
    for (let start = 0; start < entries.length; start += CHUNK) {
      const pipe = this.r.pipeline();
      for (const { pieceId, group, localAabb } of entries.slice(start, start + CHUNK)) {
        pipe.hset(keys.piece(this.puzzleId, pieceId), {
          groupId: group.id,
          rotation: 0,
        });
        pipe.hset(keys.group(this.puzzleId, group.id), {
          worldX: group.worldX,
          worldY: group.worldY,
          locked: group.locked ? 1 : 0,
          size: group.size,
          heldBy: group.heldBy ?? "",
          aabbMinX: localAabb.minX,
          aabbMinY: localAabb.minY,
          aabbMaxX: localAabb.maxX,
          aabbMaxY: localAabb.maxY,
        });
        pipe.sadd(keys.groupPieces(this.puzzleId, group.id), String(pieceId));
      }
      await pipe.exec();
    }
  }

  async addGroupPieces(id: number, pieceIds: number[]): Promise<void> {
    if (pieceIds.length === 0) return;
    await this.r.sadd(keys.groupPieces(this.puzzleId, id), ...pieceIds.map(String));
  }

  async getGroupPieces(id: number): Promise<number[]> {
    const members = await this.r.smembers(keys.groupPieces(this.puzzleId, id));
    return members.map(Number);
  }

  async readAllGroups(totalPieces: number): Promise<GroupRuntime[]> {
    const pipe = this.r.pipeline();
    for (let i = 0; i < totalPieces; i++) {
      pipe.hgetall(keys.group(this.puzzleId, i));
    }
    const results = await pipe.exec();
    const groups: GroupRuntime[] = [];
    if (!results) return groups;
    for (let i = 0; i < results.length; i++) {
      const entry = results[i];
      if (!entry) continue;
      const h = entry[1] as Record<string, string>;
      if (!h) continue;
      const g = parseGroup(i, h);
      if (g) groups.push(g);
    }
    return groups;
  }

  // Every existing group's index entry, for rebuilding the in-process group index
  // at boot and after a reset (Redis survives a restart, the index does not). `x`
  // and `y` are the body top-left (world AABB min) the index keys by; `originX` /
  // `originY` are the group origin the index reports for construction. The body min
  // is the stored local AABB min translated by the origin; a group written before
  // AABBs were stored falls back to its origin, like the broadcast scoping.
  async readAllGroupPoints(totalPieces: number): Promise<
    {
      id: number;
      x: number;
      y: number;
      originX: number;
      originY: number;
      size: number;
      locked: boolean;
    }[]
  > {
    const pipe = this.r.pipeline();
    for (let i = 0; i < totalPieces; i++) {
      pipe.hgetall(keys.group(this.puzzleId, i));
    }
    const results = await pipe.exec();
    const points: {
      id: number;
      x: number;
      y: number;
      originX: number;
      originY: number;
      size: number;
      locked: boolean;
    }[] = [];
    if (!results) return points;
    for (let i = 0; i < results.length; i++) {
      const entry = results[i];
      if (!entry) continue;
      const h = entry[1] as Record<string, string>;
      if (!h || !h.size) continue;
      const worldX = Number(h.worldX);
      const worldY = Number(h.worldY);
      const local = parseLocalAabb(h);
      points.push({
        id: i,
        x: local ? worldX + local.minX : worldX,
        y: local ? worldY + local.minY : worldY,
        originX: worldX,
        originY: worldY,
        size: Number(h.size),
        locked: h.locked === "1",
      });
    }
    return points;
  }

  async readAllPieces(totalPieces: number): Promise<StoredPiece[]> {
    const pipe = this.r.pipeline();
    for (let i = 0; i < totalPieces; i++) {
      pipe.hgetall(keys.piece(this.puzzleId, i));
    }
    const results = await pipe.exec();
    const pieces: StoredPiece[] = [];
    if (!results) return pieces;
    for (let i = 0; i < results.length; i++) {
      const entry = results[i];
      if (!entry) continue;
      const h = entry[1] as Record<string, string>;
      pieces.push(parsePiece(i, h));
    }
    return pieces;
  }

  async getLockedCount(): Promise<number> {
    const v = await this.r.get(keys.lockedCount(this.puzzleId));
    return v ? Number(v) : 0;
  }

  async addLockedCount(delta: number): Promise<number> {
    return await this.r.incrby(keys.lockedCount(this.puzzleId), delta);
  }

  // Drive every existing group to the frame origin and lock it. A piece renders
  // at its group origin plus its solved-cell canonicalOffset, so origin (0,0)
  // places all of a group's pieces in their solved cells: the whole board lands
  // assembled. Used by the dev force-complete path.
  async anchorAllGroups(totalPieces: number): Promise<void> {
    const groups = await this.readAllGroups(totalPieces);
    const pipe = this.r.pipeline();
    for (const g of groups) {
      pipe.hset(keys.group(this.puzzleId, g.id), {
        worldX: 0,
        worldY: 0,
        locked: 1,
        heldBy: "",
      });
    }
    await pipe.exec();
  }
}
