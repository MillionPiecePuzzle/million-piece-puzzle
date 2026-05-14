import type { Redis } from "ioredis";
import type { GroupRuntime, PieceRuntime } from "@mpp/shared";
import * as keys from "./redis/keys.js";

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

function parsePiece(id: number, h: Record<string, string>): PieceRuntime {
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

  async hasMeta(): Promise<boolean> {
    return (await this.r.exists(keys.puzzleMeta(this.puzzleId))) === 1;
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

  async writeGroup(g: GroupRuntime): Promise<void> {
    await this.r.hset(keys.group(this.puzzleId, g.id), {
      worldX: g.worldX,
      worldY: g.worldY,
      locked: g.locked ? 1 : 0,
      size: g.size,
      heldBy: g.heldBy ?? "",
    });
  }

  async readGroup(id: number): Promise<GroupRuntime | null> {
    const h = await this.r.hgetall(keys.group(this.puzzleId, id));
    return parseGroup(id, h);
  }

  async deleteGroup(id: number): Promise<void> {
    await this.r.del(keys.group(this.puzzleId, id), keys.groupPieces(this.puzzleId, id));
  }

  async setGroupPosition(id: number, worldX: number, worldY: number): Promise<void> {
    await this.r.hset(keys.group(this.puzzleId, id), { worldX, worldY });
  }

  async tryAcquireGroup(id: number, userId: string): Promise<string | null> {
    const key = keys.group(this.puzzleId, id);
    const lua = `
      local current = redis.call('HGET', KEYS[1], 'heldBy')
      local locked = redis.call('HGET', KEYS[1], 'locked')
      if locked == '1' then return 'LOCKED' end
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
    entries: { pieceId: number; group: GroupRuntime }[],
  ): Promise<void> {
    const CHUNK = 1000;
    for (let start = 0; start < entries.length; start += CHUNK) {
      const pipe = this.r.pipeline();
      for (const { pieceId, group } of entries.slice(start, start + CHUNK)) {
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

  async readAllPieces(totalPieces: number): Promise<PieceRuntime[]> {
    const pipe = this.r.pipeline();
    for (let i = 0; i < totalPieces; i++) {
      pipe.hgetall(keys.piece(this.puzzleId, i));
    }
    const results = await pipe.exec();
    const pieces: PieceRuntime[] = [];
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
}
