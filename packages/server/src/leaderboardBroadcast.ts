import type { LeaderboardEntry, LeaderboardStanding, LeaderboardTracker } from "@mpp/shared";
import type { Hub } from "./hub.js";

export type LeaderboardBroadcastDeps = {
  hub: Pick<Hub, "broadcast" | "send" | "allClients">;
  tracker: LeaderboardTracker;
  // Bounded profile lookup for the entries about to go out (MongoLogger.attachProfiles).
  attachProfiles: (standings: LeaderboardStanding[]) => Promise<LeaderboardEntry[]>;
  limit: number;
};

// Coalescing publisher for the live standings (see DECISIONS: live standings
// delta). Every merge that scores marks its contributor dirty; the sends
// themselves are batched at most once per minIntervalMs, so a busy board pays
// one publish per window instead of one per merge. A window carries two kinds
// of send: the top-N rows that moved, broadcast to everyone, and a personal
// standing to each connected contributor whose own row no broadcast would ever
// carry, whether they scored from outside that top N or this very publish
// pushed them out of it.
//
// Leading edge: the first merge after a quiet window publishes on the next
// tick, so the common case (a board where snaps are minutes apart) reads as
// immediate; only a burst is held back to the trailing flush.
export class LeaderboardBroadcaster {
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private lastFlushAt = 0;
  // Top-N user ids as every client currently holds them, seeded with what a
  // client joining before the first publish is served. Diffed against the next
  // publish's top N to find the rows the clients are about to drop.
  private lastRanked: Set<string>;

  constructor(
    private readonly minIntervalMs: number,
    private readonly deps: LeaderboardBroadcastDeps,
  ) {
    this.lastRanked = new Set(deps.tracker.top(deps.limit).map((s) => s.userId));
  }

  markDirty(userId: string): void {
    this.dirty.add(userId);
    this.schedule();
  }

  // Full top-N snapshot to every client, for the one change no delta can
  // express: a guest folded into an account moves a whole tally between two
  // user ids, and the guest's row has to stop existing on every client that
  // already holds it. Rare (one per sign-in that claims a guest), so paying the
  // whole list is cheaper than teaching the delta to carry removals.
  async broadcastSnapshot(): Promise<void> {
    try {
      const top = this.deps.tracker.top(this.deps.limit);
      const entries = await this.deps.attachProfiles(top);
      this.deps.hub.broadcast({ t: "leaderboard", entries });
      this.lastRanked = new Set(top.map((s) => s.userId));
    } catch (e) {
      console.error("[leaderboard] snapshot broadcast failed:", (e as Error).message);
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (this.timer || this.flushing || this.dirty.size === 0) return;
    const wait = Math.max(0, this.lastFlushAt + this.minIntervalMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, wait);
  }

  private async flush(): Promise<void> {
    const users = this.dirty;
    this.dirty = new Set();
    this.flushing = true;
    try {
      await this.publish(users);
    } catch (e) {
      // A publish is the only thing that moves these tallies onto the clients,
      // so a failed window hands its contributors back to the next one rather
      // than stranding their rows until each of them happens to score again.
      // Merged, not restored: merges landing during the failed publish are
      // already in the new set.
      for (const userId of users) this.dirty.add(userId);
      console.error("[leaderboard] delta broadcast failed:", (e as Error).message);
    } finally {
      this.flushing = false;
      // Measured from the end of the publish, so a slow profile lookup spaces
      // the next window out rather than stacking publishes back to back.
      this.lastFlushAt = Date.now();
      this.schedule();
    }
  }

  private async publish(users: ReadonlySet<string>): Promise<void> {
    const top = this.deps.tracker.top(this.deps.limit);
    const ranked = new Set(top.map((s) => s.userId));
    const moved = top.filter((s) => users.has(s.userId));
    if (moved.length > 0) {
      const entries = await this.deps.attachProfiles(moved);
      this.deps.hub.broadcast({ t: "leaderboard_delta", entries });
    }
    // Rows this publish pushes past the limit: the clients truncate the folded
    // delta back to the same top N, so a contributor displaced by someone
    // else's merge loses their own row while being in no delta and in no
    // window's dirty set. Bounded by how many rows entered the top N, and read
    // after the broadcast so a failed one leaves the previous top N in place to
    // diff the retry against.
    const displaced = [...this.lastRanked].filter((id) => !ranked.has(id));
    this.lastRanked = ranked;
    // Only contributors who are actually connected get a personal standing:
    // one whose merge landed and then left has nothing to receive it.
    const owed = new Set([...users, ...displaced]);
    const recipients = this.deps.hub
      .allClients()
      .filter((c) => owed.has(c.userId) && !ranked.has(c.userId));
    if (recipients.length === 0) return;
    const standings = this.deps.tracker.standingsFor(recipients.map((c) => c.userId));
    for (const client of recipients) {
      const standing = standings.get(client.userId);
      if (!standing) continue;
      this.deps.hub.send(client, {
        t: "standing",
        pieces: standing.pieces,
        rank: standing.rank,
      });
    }
  }
}
