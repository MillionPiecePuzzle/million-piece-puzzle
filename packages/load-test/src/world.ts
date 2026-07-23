// Local mirror of authoritative server state for one bot.
//
// Protocol v4: `welcome` carries no board, so the world starts empty and is
// filled incrementally from the region_state construction stream the server
// sends for the cells a bot's viewport enters. It is then updated from
// broadcasts (SGrabOk, SDrag, SDrop, SSnap). Lets a bot pick a non-held,
// non-locked group to grab and know where it currently is in world space. Ids and
// positions are opaque wire values (seed-permuted ids, anchor world positions);
// the bot grabs/drops them as-is and ignores the per-piece (dx, dy) offsets since
// it does not render.

import type { PlayZone, SDrag, SDrop, SGrabOk, SRegionState, SSnap } from "@mpp/shared";

// The bot only needs each piece's current group; it never renders, so it drops the
// wire offset and keeps just id -> group.
type BotPiece = { id: number; groupId: number };

// The bot's local mirror of a group's wire-visible state. Shaped after the wire
// (region_state/snap), not the server's internal GroupRuntime, which no longer
// carries locked (a locked piece has no live group server-side).
type BotGroup = {
  id: number;
  worldX: number;
  worldY: number;
  size: number;
  locked: boolean;
  heldBy: string | null;
};

export class World {
  readonly pieces = new Map<number, BotPiece>();
  readonly groups = new Map<number, BotGroup>();
  playZone: PlayZone = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  // Bounds memory: bot.ts jumps the viewport to a brand new random window every
  // second rather than panning, so groups learned for the previous window are
  // about to be irrelevant. Without this, region_state keeps upserting and
  // nothing ever removes, so a bot's mirror grows toward the full board and a
  // multi-bot run against a 1M-piece board OOMs well before the run duration
  // elapses. The held group survives the reset: a drag in progress does not
  // re-read it from this map once started, but the snap handler does check it
  // is still here, and would otherwise wrongly treat every unrelated snap on
  // the board as "my held group changed".
  resetForNewViewport(keepGroupId: number | null): void {
    const kept = keepGroupId !== null ? this.groups.get(keepGroupId) : undefined;
    this.groups.clear();
    this.pieces.clear();
    if (kept) this.groups.set(keepGroupId as number, kept);
  }

  // Upsert the groups in a region_state window. An unknown group is built; a
  // known one has its membership, size and locked state reconciled, and its
  // position adopted only when nobody holds it (a held group's live drag/drop is
  // the authority, so a later resync must not rewind it).
  applyRegionState(msg: SRegionState): void {
    for (const rg of msg.groups) {
      const existing = this.groups.get(rg.groupId);
      if (!existing) {
        this.groups.set(rg.groupId, {
          id: rg.groupId,
          worldX: rg.worldX,
          worldY: rg.worldY,
          size: rg.size,
          locked: rg.locked,
          heldBy: null,
        });
      } else {
        if (existing.heldBy === null) {
          existing.worldX = rg.worldX;
          existing.worldY = rg.worldY;
        }
        existing.size = rg.size;
        existing.locked = rg.locked;
      }
      for (const wp of rg.pieces) {
        const p = this.pieces.get(wp.id);
        if (p) p.groupId = rg.groupId;
        else this.pieces.set(wp.id, { id: wp.id, groupId: rg.groupId });
      }
    }
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
    for (const wp of msg.addedPieceIds) {
      const piece = this.pieces.get(wp.id);
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
  pickFreeGroup(rng: () => number): BotGroup | null {
    const candidates: BotGroup[] = [];
    for (const g of this.groups.values()) {
      if (g.heldBy === null && !g.locked) candidates.push(g);
    }
    if (candidates.length === 0) return null;
    const idx = Math.floor(rng() * candidates.length);
    return candidates[idx] ?? null;
  }
}
