import type { ActivityItem, LeaderboardEntry, LiveResponse } from "@mpp/shared";

// What the landing shows while the board is live: six contributors and ten
// placements. The two depths differ because the two cards sit side by side and
// stretch to the taller one: a contributor row is 36px tall against an activity
// line's 16px, so six placements left a third of that card empty. Small on
// purpose all the same, the body is polled every few seconds by every open
// landing, and the page renders exactly this many.
export const LIVE_CONTRIBUTORS_LIMIT = 6;
export const LIVE_ACTIVITY_LIMIT = 10;

export type LiveFiguresSource = {
  totalPieces: () => number;
  // Read live (reset reassigns ctx.meta), so a completed board is reported on
  // the next rebuild rather than at the next restart.
  status: () => "active" | "completed";
  lockedCount: () => Promise<number>;
  leaderboard: (limit: number) => Promise<LeaderboardEntry[]>;
  activity: (limit: number) => Promise<ActivityItem[]>;
};

// Builds GET /live's body at most once per ttlMs, however many requests arrive.
// Every open landing polls that route, so without this floor N readers would put
// N Redis reads and 2N Mongo queries per poll on the origin; with it the cost is
// one rebuild per window whatever N is, which is what makes the route safe to
// serve when the edge cache in front of it is cold, or not configured yet.
// Concurrent callers arriving on a stale memo share the one rebuild instead of
// each starting their own, and a failed rebuild keeps serving the last body.
export class LiveFigures {
  private cached: LiveResponse | null = null;
  private builtAt = 0;
  private inFlight: Promise<LiveResponse | null> | null = null;

  constructor(
    private readonly ttlMs: number,
    private readonly source: LiveFiguresSource,
    private readonly now: () => number = Date.now,
  ) {}

  async read(): Promise<LiveResponse | null> {
    if (this.cached && this.now() - this.builtAt < this.ttlMs) return this.cached;
    if (!this.inFlight) {
      this.inFlight = this.build().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async build(): Promise<LiveResponse | null> {
    try {
      const [locked, leaderboard, activity] = await Promise.all([
        this.source.lockedCount(),
        this.source.leaderboard(LIVE_CONTRIBUTORS_LIMIT),
        this.source.activity(LIVE_ACTIVITY_LIMIT),
      ]);
      const at = this.now();
      this.cached = {
        figuresAt: at,
        status: this.source.status(),
        progress: { locked, total: this.source.totalPieces() },
        leaderboard,
        activity,
      };
      this.builtAt = at;
    } catch (e) {
      // builtAt is left where it was, so the next request retries rather than
      // waiting out a window on a body that failed to refresh.
      console.error("[live] rebuild failed:", (e as Error).message);
    }
    return this.cached;
  }
}
