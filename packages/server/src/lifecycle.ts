import type { ImageManifest, PlayZone } from "@mpp/shared";
import { PROTOCOL_VERSION } from "@mpp/shared";
import type { BoardSnapshot } from "./keyframe.js";
import type { Hub, Client } from "./hub.js";
import { LEADERBOARD_LIMIT, type Context } from "./handlers.js";
import {
  forceInitPuzzle,
  playZoneForManifest,
  rebuildGroupIndex,
  rebuildMinimapGrid,
} from "./init.js";

// Anchoring entries sent to seed a connecting client's activity ticker. Matches
// the ticker's display capacity on the frontend.
export const ACTIVITY_BACKFILL_LIMIT = 6;

// Holds the single puzzle for its lifetime: serves welcomes, marks completion
// when the locked count reaches the total, and supports a manual reset back to
// a fresh scattered board.
export class PuzzleLifecycle {
  private resetting = false;
  private readonly playZone: PlayZone;
  // Set after construction (the publisher is created later in index.ts). A
  // reset/complete transition forces a fresh keyframe so the frozen body reflects
  // the new board immediately rather than at the next interval; `latest` also
  // gives `sendWelcome` the current minimap grid without a per-join board read.
  private keyframePublisher: {
    regenerate: (force?: boolean) => Promise<void>;
    latest: () => BoardSnapshot | null;
  } | null = null;

  constructor(
    private readonly ctx: Context,
    private readonly manifest: ImageManifest,
  ) {
    this.playZone = playZoneForManifest(manifest, ctx.generationSeed);
  }

  attachKeyframePublisher(publisher: {
    regenerate: (force?: boolean) => Promise<void>;
    latest: () => BoardSnapshot | null;
  }): void {
    this.keyframePublisher = publisher;
  }

  // Protocol v3: welcome carries no board. The client builds an empty board and
  // streams groups per viewport via region_state, so this sends only welcome,
  // the activity backfill, the leaderboard, and one minimap grid (so a fresh
  // contributor has the overview before the first periodic broadcast). The
  // client's cell subscription is reset so its next viewport re-streams its
  // region, which matters on a rebuild (welcome resent) where the connection
  // persists but the board was discarded.
  async sendWelcome(client: Client): Promise<void> {
    const lockedCount = await this.ctx.state.getLockedCount();
    this.ctx.hub.resetSubscription(client);
    this.ctx.hub.send(client, {
      t: "welcome",
      userId: client.userId,
      protocolVersion: PROTOCOL_VERSION,
      puzzleId: this.ctx.puzzleId,
      lockedCount,
      playZone: this.playZone,
      eventStartsAt: this.ctx.eventStartsAt,
      broadcastMaxCells: this.ctx.broadcastMaxCells,
    });
    const items = await this.ctx.mongo.recentMerges(this.ctx.puzzleId, ACTIVITY_BACKFILL_LIMIT);
    this.ctx.hub.send(client, { t: "activity", items });
    const entries = await this.ctx.mongo.leaderboard(this.ctx.puzzleId, LEADERBOARD_LIMIT);
    this.ctx.hub.send(client, { t: "leaderboard", entries });
    // The minimap grid is reused from the latest keyframe (computed on the
    // keyframe cadence), so a join costs no extra full-board read. None yet at
    // the very first boot tick: the next periodic minimap broadcast fills it.
    const grid = this.keyframePublisher?.latest()?.minimapGrid;
    if (grid) this.ctx.hub.send(client, { t: "minimap", grid });
  }

  async resetCurrent(): Promise<void> {
    if (this.resetting) return;
    this.resetting = true;
    try {
      await this.ctx.state.wipePuzzle(this.ctx.meta.totalPieces);
      // The leaderboard and activity feed are derived from the merge log, so the
      // fresh board must start with an empty log, not just empty Redis state.
      await this.ctx.mongo.clearPuzzle(this.ctx.puzzleId);
      const meta = await forceInitPuzzle(this.ctx.state, this.manifest, this.ctx.generationSeed);
      this.ctx.meta = meta;
      // Fresh scattered board: rebuild the group index off the new Redis state so
      // resyncs reflect the reset, not the old positions.
      await rebuildGroupIndex(this.ctx.groupIndex, this.ctx.state, meta.totalPieces);
      // Same for the minimap grid: the incremental tracker has no way to know
      // about a wipe, so it must be reseeded from the fresh board too.
      await rebuildMinimapGrid(this.ctx.minimapGrid, this.ctx.state, meta.totalPieces);
      // Regenerate before resending welcome so the welcome's minimap grid (read
      // from the latest keyframe) reflects the fresh scatter, not the old board.
      await this.keyframePublisher?.regenerate(true);
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
      mergedSize: total,
      at: new Date(),
    });
    await this.markCompleted();
    // Every group is now anchored at the frame origin; rebuild the index so its
    // positions match the assembled board (force-complete moves groups directly,
    // outside the per-group drop/merge paths that maintain the index).
    await rebuildGroupIndex(this.ctx.groupIndex, this.ctx.state, total);
    // Same reasoning for the minimap grid: anchorAllGroups moves every group
    // directly, bypassing the incremental applyTranslation calls in handleDrop.
    await rebuildMinimapGrid(this.ctx.minimapGrid, this.ctx.state, total);
    // forceComplete sets state directly (no per-group snaps), so the assembled
    // board only reaches the frozen keyframe through a forced regeneration;
    // regenerate before resending welcome so its minimap grid is the assembled one.
    await this.keyframePublisher?.regenerate(true);
    await this.broadcastFreshState();
  }

  // Resend welcome to every client after a reset/force-complete so each rebuilds
  // an empty board and re-streams its region from its next viewport. The fresh
  // keyframe is forced by the callers, so the welcome's minimap grid reflects the
  // new board.
  private async broadcastFreshState(): Promise<void> {
    const hub: Hub = this.ctx.hub;
    const clients = hub.allClients();
    for (const c of clients) {
      await this.sendWelcome(c);
    }
  }
}
