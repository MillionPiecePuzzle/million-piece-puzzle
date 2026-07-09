import type { ActivityItem, LeaderboardEntry, MinimapGrid } from "@mpp/shared";

// The in-memory board snapshot the publisher rebuilds on a fixed cadence. It feeds
// the periodic minimap broadcast (contributors) and the landing snapshot (public
// progress and standings), so it carries only those: the live locked count, the
// standings, the recent-placement feed, and the downsampled density grid. The
// grid itself is read from the incrementally-maintained MinimapGridTracker (see
// DECISIONS: server-computed minimap grid), so a regenerate never scans the board.
export type BoardSnapshot = {
  lockedCount: number;
  totalPieces: number;
  leaderboard: LeaderboardEntry[];
  activity: ActivityItem[];
  minimapGrid: MinimapGrid;
};

export type KeyframeSource = {
  totalPieces: () => number;
  // Current puzzle status, read live (reset reassigns ctx.meta), so the idle gate
  // always reflects the latest lifecycle state.
  status: () => "active" | "completed";
  eventStartsAt: () => number;
  getLockedCount: () => Promise<number>;
  leaderboard: () => Promise<LeaderboardEntry[]>;
  activity: () => Promise<ActivityItem[]>;
  // A defensive-copy read of the live minimap grid (MinimapGridTracker.snapshot),
  // O(cells), not O(board): the grid is maintained incrementally on every drop and
  // merge rather than rebuilt here.
  minimapGrid: () => MinimapGrid;
};

// Cheap by construction: every field above is either an in-memory getter or a
// single Redis scalar read (getLockedCount), never a full-board scan.
export async function buildSnapshot(source: KeyframeSource): Promise<BoardSnapshot> {
  const [lockedCount, leaderboard, activity] = await Promise.all([
    source.getLockedCount(),
    source.leaderboard(),
    source.activity(),
  ]);
  return {
    lockedCount,
    totalPieces: source.totalPieces(),
    leaderboard,
    activity,
    minimapGrid: source.minimapGrid(),
  };
}

// In-memory publisher: a ticker regenerates the board snapshot on a fixed interval
// and the latest one feeds the minimap broadcast and the landing snapshot. A
// regeneration failure keeps the previous snapshot, so a transient Redis hiccup
// never blanks the minimap or the landing figures.
//
// Idle gate: a tick regenerates only while the event is live (status active and
// past eventStartsAt). Before the start and after completion the publisher freezes
// on its last snapshot. One snapshot is built at boot regardless (force) so a
// pre-event minimap exists, and a reset/complete transition forces a fresh one so
// the frozen snapshot reflects it immediately.
export class KeyframePublisher {
  private latestSnapshot: BoardSnapshot | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private regenerating = false;
  // Called after every successful regenerate with the new snapshot. index.ts wires
  // it to broadcast the minimap grid to contributors, so the contributor minimap
  // cadence is tied to this interval (and its idle gate) with no extra board read.
  onRegenerated: ((snapshot: BoardSnapshot) => void) | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly source: KeyframeSource,
  ) {}

  isLive(): boolean {
    const startsAt = this.source.eventStartsAt();
    return this.source.status() === "active" && (startsAt === 0 || Date.now() >= startsAt);
  }

  start(): void {
    if (this.timer) return;
    void this.regenerate(true);
    this.timer = setInterval(() => {
      void this.regenerate();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  latest(): BoardSnapshot | null {
    return this.latestSnapshot;
  }

  async regenerate(force = false): Promise<void> {
    if (this.regenerating) return;
    // Skip the read and keep the last snapshot when not live, unless forced or
    // none exists yet (boot).
    if (!force && this.latestSnapshot !== null && !this.isLive()) return;
    this.regenerating = true;
    try {
      const snapshot = await buildSnapshot(this.source);
      this.latestSnapshot = snapshot;
      this.onRegenerated?.(snapshot);
    } catch (e) {
      console.error("[keyframe] regenerate failed:", (e as Error).message);
    } finally {
      this.regenerating = false;
    }
  }
}
