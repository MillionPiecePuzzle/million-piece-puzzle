import type { ImageManifest, PlayZone } from "@mpp/shared";
import { PROTOCOL_VERSION } from "@mpp/shared";
import type { Hub, Client } from "./hub.js";
import { LEADERBOARD_LIMIT, type Context } from "./handlers.js";
import { forceInitPuzzle, initPuzzleIfEmpty, playZoneForManifest } from "./init.js";

// Anchoring entries sent to seed a connecting client's activity ticker. Matches
// the ticker's display capacity on the frontend.
const ACTIVITY_BACKFILL_LIMIT = 6;

export class PuzzleCycle {
  private cycleScheduled = false;
  private cycleTimer: ReturnType<typeof setTimeout> | null = null;
  private cycling = false;
  // Play zone per puzzle id, memoized: it is a pure function of the manifest,
  // so it is computed once per puzzle and reused for every welcome.
  private readonly playZones = new Map<string, PlayZone>();

  constructor(
    private readonly ctx: Context,
    private readonly manifests: ImageManifest[],
    private readonly cycleDelayMs: number,
  ) {}

  manifestOf(puzzleId: string): ImageManifest {
    const m = this.manifests.find((x) => x.puzzleId === puzzleId);
    if (!m) throw new Error(`unknown puzzleId ${puzzleId}`);
    return m;
  }

  currentManifest(): ImageManifest {
    return this.manifestOf(this.ctx.puzzleId);
  }

  private playZoneFor(puzzleId: string): PlayZone {
    let zone = this.playZones.get(puzzleId);
    if (!zone) {
      zone = playZoneForManifest(this.manifestOf(puzzleId));
      this.playZones.set(puzzleId, zone);
    }
    return zone;
  }

  async restoreOrPickFirst(): Promise<void> {
    const active = await this.ctx.state.readActivePuzzleId();
    const fallback = this.manifests[0];
    if (!fallback) throw new Error("PuzzleCycle requires at least one manifest");
    const id =
      active && this.manifests.some((m) => m.puzzleId === active) ? active : fallback.puzzleId;
    await this.setActive(id, false);
  }

  async sendWelcomeAndState(client: Client): Promise<void> {
    const lockedCount = await this.ctx.state.getLockedCount();
    this.ctx.hub.send(client, {
      t: "welcome",
      userId: client.userId,
      protocolVersion: PROTOCOL_VERSION,
      puzzleId: this.ctx.puzzleId,
      lockedCount,
      playZone: this.playZoneFor(this.ctx.puzzleId),
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
    // Current standings so the in-game leaderboard panel is populated on join,
    // and the completion modal too for a client joining a finished puzzle.
    const entries = await this.ctx.mongo.leaderboard(this.ctx.puzzleId, LEADERBOARD_LIMIT);
    this.ctx.hub.send(client, { t: "leaderboard", entries });
  }

  async resetCurrent(): Promise<void> {
    if (this.cycling) return;
    this.cancelScheduledCycle();
    this.cycling = true;
    try {
      await this.ctx.state.wipePuzzle(this.ctx.meta.totalPieces);
      const meta = await forceInitPuzzle(this.ctx.state, this.currentManifest());
      this.ctx.meta = meta;
      await this.broadcastFreshState();
    } finally {
      this.cycling = false;
    }
  }

  scheduleNextCycle(): void {
    if (this.cycleScheduled || this.cycling) return;
    this.cycleScheduled = true;
    this.cycleTimer = setTimeout(() => {
      this.cycleScheduled = false;
      this.cycleTimer = null;
      void this.advance();
    }, this.cycleDelayMs);
  }

  private cancelScheduledCycle(): void {
    if (this.cycleTimer !== null) {
      clearTimeout(this.cycleTimer);
      this.cycleTimer = null;
    }
    this.cycleScheduled = false;
  }

  private async advance(): Promise<void> {
    if (this.cycling) return;
    this.cycling = true;
    try {
      const currentIndex = this.manifests.findIndex((m) => m.puzzleId === this.ctx.puzzleId);
      const nextIndex = (currentIndex + 1) % this.manifests.length;
      const nextManifest = this.manifests[nextIndex];
      if (!nextManifest) throw new Error("cycle: no next manifest");
      await this.ctx.state.wipePuzzle(this.ctx.meta.totalPieces);
      await this.setActive(nextManifest.puzzleId, true);
      await this.broadcastFreshState();
      console.log(`[cycle] now active: ${nextManifest.puzzleId}`);
    } finally {
      this.cycling = false;
    }
  }

  private async setActive(puzzleId: string, forceInit: boolean): Promise<void> {
    this.ctx.state.setPuzzleId(puzzleId);
    this.ctx.puzzleId = puzzleId;
    const manifest = this.manifestOf(puzzleId);
    const meta = forceInit
      ? await forceInitPuzzle(this.ctx.state, manifest)
      : await initPuzzleIfEmpty(this.ctx.state, manifest);
    this.ctx.meta = meta;
    await this.ctx.state.writeActivePuzzleId(puzzleId);
  }

  private async broadcastFreshState(): Promise<void> {
    const hub: Hub = this.ctx.hub;
    const clients = hub.allClients();
    for (const c of clients) {
      await this.sendWelcomeAndState(c);
    }
  }
}
