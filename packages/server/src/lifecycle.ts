import type { ImageManifest, PlayZone } from "@mpp/shared";
import { PROTOCOL_VERSION } from "@mpp/shared";
import type { Hub, Client } from "./hub.js";
import { LEADERBOARD_LIMIT, type Context } from "./handlers.js";
import { forceInitPuzzle, playZoneForManifest } from "./init.js";

// Anchoring entries sent to seed a connecting client's activity ticker. Matches
// the ticker's display capacity on the frontend.
export const ACTIVITY_BACKFILL_LIMIT = 6;

// Holds the single puzzle for its lifetime: serves welcomes, marks completion
// when the locked count reaches the total, and supports a manual reset back to
// a fresh scattered board.
export class PuzzleLifecycle {
  private resetting = false;
  private readonly playZone: PlayZone;

  constructor(
    private readonly ctx: Context,
    private readonly manifest: ImageManifest,
  ) {
    this.playZone = playZoneForManifest(manifest);
  }

  currentManifest(): ImageManifest {
    return this.manifest;
  }

  currentPlayZone(): PlayZone {
    return this.playZone;
  }

  async sendWelcomeAndState(client: Client): Promise<void> {
    const lockedCount = await this.ctx.state.getLockedCount();
    this.ctx.hub.send(client, {
      t: "welcome",
      userId: client.userId,
      protocolVersion: PROTOCOL_VERSION,
      puzzleId: this.ctx.puzzleId,
      lockedCount,
      playZone: this.playZone,
    });
    const [pieces, groups] = await Promise.all([
      this.ctx.state.readAllPieces(this.ctx.meta.totalPieces),
      this.ctx.state.readAllGroups(this.ctx.meta.totalPieces),
    ]);
    this.ctx.hub.send(client, { t: "state", pieces, groups });
    const items = await this.ctx.mongo.recentAnchoredMerges(
      this.ctx.puzzleId,
      ACTIVITY_BACKFILL_LIMIT,
    );
    this.ctx.hub.send(client, { t: "activity", items });
    const entries = await this.ctx.mongo.leaderboard(this.ctx.puzzleId, LEADERBOARD_LIMIT);
    this.ctx.hub.send(client, { t: "leaderboard", entries });
  }

  async resetCurrent(): Promise<void> {
    if (this.resetting) return;
    this.resetting = true;
    try {
      await this.ctx.state.wipePuzzle(this.ctx.meta.totalPieces);
      // The leaderboard and activity feed are derived from the merge log, so the
      // fresh board must start with an empty log, not just empty Redis state.
      await this.ctx.mongo.clearPuzzle(this.ctx.puzzleId);
      const meta = await forceInitPuzzle(this.ctx.state, this.manifest);
      this.ctx.meta = meta;
      await this.broadcastFreshState();
    } finally {
      this.resetting = false;
    }
  }

  async markCompleted(): Promise<void> {
    if (this.ctx.meta.status === "completed") return;
    this.ctx.meta = { ...this.ctx.meta, status: "completed" };
    await this.ctx.state.writeMeta(this.ctx.meta);
  }

  // Dev shortcut: assemble the board. Every group is anchored at the frame
  // origin (so each piece lands in its solved cell), the locked counter is
  // driven to the total, and the fresh assembled state is rebroadcast so all
  // clients rebuild onto the finished picture. resetCurrent is the way back to
  // a playable board. The executing client is credited for every piece not
  // already attributed: the leaderboard credits each piece to the first merge
  // (by `at`) that dragged it, so logging one merge now whose droppedPieceIds
  // lists all pieces leaves earlier contributions intact and assigns the rest
  // to the executor.
  async forceComplete(userId: string): Promise<void> {
    const total = this.ctx.meta.totalPieces;
    await this.ctx.state.anchorAllGroups(total);
    const current = await this.ctx.state.getLockedCount();
    const remaining = total - current;
    if (remaining > 0) await this.ctx.state.addLockedCount(remaining);
    await this.ctx.mongo.logMerge({
      puzzleId: this.ctx.puzzleId,
      userId,
      addedPieceIds: [],
      droppedPieceIds: Array.from({ length: total }, (_, i) => i),
      targetAnchorPieceId: 0,
      anchored: true,
      lockedDelta: Math.max(0, remaining),
      at: new Date(),
    });
    await this.markCompleted();
    await this.broadcastFreshState();
  }

  private async broadcastFreshState(): Promise<void> {
    const hub: Hub = this.ctx.hub;
    const clients = hub.allClients();
    for (const c of clients) {
      await this.sendWelcomeAndState(c);
    }
  }
}
