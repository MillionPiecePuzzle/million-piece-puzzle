import type { ImageManifest, PlayZone } from "@mpp/shared";
import { PROTOCOL_VERSION } from "@mpp/shared";
import type { BoardSnapshot } from "./keyframe.js";
import type { Hub, Client } from "./hub.js";
import { LEADERBOARD_LIMIT, type Context } from "./handlers.js";
import {
  forceInitPuzzle,
  playZoneForManifest,
  rebuildGroupIndex,
  rebuildLockedPieceIndex,
  rebuildMinimapGrid,
} from "./init.js";
import { allCellKeysForGrid } from "./cellComposite.js";

// Anchoring entries sent to seed a connecting client's activity ticker. Matches
// the ticker's display capacity on the frontend.
export const ACTIVITY_BACKFILL_LIMIT = 6;

// Mongo's per-document BSON limit is 16 MB, but a cluster_merges doc carrying
// two id arrays across every piece hits a Node buffer error inside the BSON
// serializer well before that limit (observed failing at ~995 000 ids in one
// doc; see seed-lock-scenario.ts, which hit and fixed the same failure).
// Chunking is safe: replayMerges (stateInvariants.ts) only sums lockedDelta
// and unions lockedPieceIds across the whole log, so N smaller docs replay
// identically to one giant one.
export const MERGE_LOG_CHUNK = 50000;

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
      // Same for the locked-piece index and the minimap grid: neither tracker
      // has any way to know about a wipe, so both must be reseeded from the
      // fresh (fully unlocked) board too.
      await rebuildLockedPieceIndex(this.ctx.lockedPieces, this.ctx.state, meta.totalPieces);
      await rebuildMinimapGrid(this.ctx.minimapGrid, this.ctx.state, meta.totalPieces);
      // Every previously-baked cell composite is now actively wrong, not just
      // stale (it would show a cell as locked that just went back to loose),
      // so this has to clear rather than let the next touch overwrite it (see
      // state.clearCellCompositeVersions).
      if (this.ctx.cellComposites) {
        await this.ctx.state.clearCellCompositeVersions();
        this.ctx.cellComposites.clear();
      }
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
  // (by `at`) that dragged it, so logging chunked merges now whose
  // droppedPieceIds together list every piece exactly once leaves earlier
  // contributions intact and assigns the rest to the executor.
  async forceComplete(userId: string): Promise<void> {
    const total = this.ctx.meta.totalPieces;
    await this.ctx.state.anchorAllGroups(total);
    const current = await this.ctx.state.getLockedCount();
    const remaining = Math.max(0, total - current);
    if (remaining > 0) await this.ctx.state.addLockedCount(remaining);
    // Logged in MERGE_LOG_CHUNK-sized docs (see its comment): each one's
    // droppedPieceIds/lockedPieceIds lists only its own slice, same
    // already-locked-pieces-listed-again approximation the single-doc version
    // made (harmless: the invariant replay unions locked ids, it does not sum
    // them). lockedDelta has no such per-piece source (which specific ids were
    // already locked isn't tracked here), so it is spread across chunks by
    // cumulative share of `remaining`, with running-cumulative rounding
    // keeping the total exact.
    const at = new Date();
    let deltaAssigned = 0;
    for (let start = 0; start < total; start += MERGE_LOG_CHUNK) {
      const end = Math.min(start + MERGE_LOG_CHUNK, total);
      const slice = Array.from({ length: end - start }, (_, i) => start + i);
      const targetCumulative = end >= total ? remaining : Math.round((remaining * end) / total);
      const chunkDelta = targetCumulative - deltaAssigned;
      deltaAssigned = targetCumulative;
      await this.ctx.mongo.logMerge({
        puzzleId: this.ctx.puzzleId,
        userId,
        addedPieceIds: [],
        droppedPieceIds: slice,
        targetAnchorPieceId: slice[0] ?? 0,
        anchored: true,
        lockedDelta: chunkDelta,
        lockedPieceIds: slice,
        mergedSize: slice.length,
        at,
      });
    }
    await this.markCompleted();
    // Every group is now anchored at the frame origin; rebuild the index so its
    // positions match the assembled board (force-complete moves groups directly,
    // outside the per-group drop/merge paths that maintain the index).
    await rebuildGroupIndex(this.ctx.groupIndex, this.ctx.state, total);
    // Same reasoning for the locked-piece index and the minimap grid:
    // anchorAllGroups locks and moves everything directly, bypassing the
    // incremental ctx.lockedPieces.lock/applyTranslation calls applyMerge makes.
    await rebuildLockedPieceIndex(this.ctx.lockedPieces, this.ctx.state, total);
    await rebuildMinimapGrid(this.ctx.minimapGrid, this.ctx.state, total);
    // force-complete has no per-piece incremental hook telling us which cells
    // just gained a lock (anchorAllGroups moves everything directly, bypassing
    // applyMerge's own dirty-marking), so every cell in the grid is dirtied
    // instead; a rare dev-only bulk operation, so redundantly recompositing an
    // already-complete cell is an acceptable one-off cost (see
    // allCellKeysForGrid). Runs after the locked-piece index rebuild above so
    // the compositor's isLocked reads see the fresh, fully-anchored state.
    if (this.ctx.cellCompositor) {
      const allCells = allCellKeysForGrid(
        this.ctx.meta.gridCols,
        this.ctx.meta.gridRows,
        this.ctx.meta.pieceSize,
        this.ctx.worldTileSize,
      );
      this.ctx.cellCompositor.markDirty(allCells);
    }
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
