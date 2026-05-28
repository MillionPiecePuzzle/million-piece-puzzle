// Local mirror of authoritative server state for one bot.
//
// Updated from SState (initial) and from broadcasts (SGrabOk, SDrag, SDrop,
// SSnap). Lets a bot pick a non-held, non-locked group to grab and know where
// it currently is in world space.

import type {
  GroupRuntime,
  PieceRuntime,
  PlayZone,
  SDrag,
  SDrop,
  SGrabOk,
  SSnap,
  SState,
} from "@mpp/shared";

export class World {
  readonly pieces = new Map<number, PieceRuntime>();
  readonly groups = new Map<number, GroupRuntime>();
  playZone: PlayZone = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  loadState(state: SState): void {
    this.pieces.clear();
    this.groups.clear();
    for (const p of state.pieces) this.pieces.set(p.id, { ...p });
    for (const g of state.groups) this.groups.set(g.id, { ...g });
  }

  applyGrabOk(msg: SGrabOk): void {
    const g = this.groups.get(msg.groupId);
    if (g) g.heldBy = msg.userId;
  }

  applyDrag(msg: SDrag): void {
    const g = this.groups.get(msg.groupId);
    if (!g) return;
    g.worldX = msg.worldX;
    g.worldY = msg.worldY;
  }

  applyDrop(msg: SDrop): void {
    const g = this.groups.get(msg.groupId);
    if (!g) return;
    g.worldX = msg.worldX;
    g.worldY = msg.worldY;
    g.heldBy = null;
  }

  applySnap(msg: SSnap): void {
    const oldGroupIds = new Set<number>();
    for (const pieceId of msg.addedPieceIds) {
      const piece = this.pieces.get(pieceId);
      if (!piece) continue;
      if (piece.groupId !== msg.newGroupId) {
        oldGroupIds.add(piece.groupId);
        piece.groupId = msg.newGroupId;
      }
    }
    for (const oldId of oldGroupIds) this.groups.delete(oldId);
    const g = this.groups.get(msg.newGroupId);
    if (g) {
      g.worldX = msg.worldX;
      g.worldY = msg.worldY;
      g.heldBy = null;
      g.locked = msg.anchored;
      g.size += msg.addedPieceIds.length;
    }
  }

  // Returns a random group that is not currently held and not locked, or null
  // if none exists. Used by the bot to pick its next grab target.
  pickFreeGroup(rng: () => number): GroupRuntime | null {
    const candidates: GroupRuntime[] = [];
    for (const g of this.groups.values()) {
      if (g.heldBy === null && !g.locked) candidates.push(g);
    }
    if (candidates.length === 0) return null;
    const idx = Math.floor(rng() * candidates.length);
    return candidates[idx] ?? null;
  }
}
