// Per-user contribution standings: each piece scores one point, credited to
// the user of the first merge (by time) that dragged it, or that locked it
// while it had never been dragged (see DECISIONS: leaderboard scoring). A
// from-scratch rebuild derives the full standings from every piece's
// first-scorer row, the same shape a Mongo merge-log scan produces; an
// incremental update folds in one merge's scored pieces without rescanning the
// log, mirroring MinimapGridTracker's own rebuildFromBoard/applyTranslation
// split.

// One piece's first-ever scorer: pieceId is the internal grid id (the same
// space droppedPieceIds uses), userId the merge's dragger.
export type LeaderboardScoreRow = { pieceId: number; userId: string };

export type LeaderboardStanding = { userId: string; pieces: number };

// A standing plus its global position: the competition rank, 1 + the number of
// contributors with strictly more pieces, so tied contributors share one rank.
// Only ever needed for a contributor ranked outside the broadcast top N, whose
// rank cannot be read off the standings list their client holds.
export type RankedStanding = LeaderboardStanding & { rank: number };

// Cap on standings entries sent over the wire, the top N by pieces. Bounds the
// payload regardless of how many contributors the puzzle has, and bounds the
// list a client keeps: it truncates a merged delta back to the same N.
export const LEADERBOARD_LIMIT = 100;

// Standings order: highest first, ties broken by userId ascending (matches the
// Mongo aggregation's own sort). Shared with the client so a delta folded into
// the list it holds re-sorts exactly the way the server ranks.
export function compareStandings(a: LeaderboardStanding, b: LeaderboardStanding): number {
  return b.pieces - a.pieces || (a.userId < b.userId ? -1 : 1);
}

// Number of tallies strictly greater than `pieces` in a descending-sorted list:
// the leftmost index whose value is no longer greater.
function countAbove(descending: readonly number[], pieces: number): number {
  let lo = 0;
  let hi = descending.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (descending[mid]! > pieces) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Incrementally-maintained per-user piece tally. A full rebuild
// (rebuildFromLog) is the only source of truth, paid once at boot/reset/
// force-complete and a slow periodic resync; every merge in between calls
// recordDrop instead of rescanning the log, moving only the pieces the merge
// actually dropped.
export class LeaderboardTracker {
  private scored: Uint8Array;
  private perUser = new Map<string, number>();

  constructor(private readonly totalPieces: number) {
    this.scored = new Uint8Array(totalPieces);
  }

  // O(rows): overwrites the live standings with a from-scratch reconstruction.
  // rows must carry exactly one entry per piece ever scored (its first scorer
  // only), the same shape MongoLogger.leaderboardScoreRows produces.
  // Meant for boot, reset, force-complete, and the periodic resync, never the
  // per-merge hot path.
  rebuildFromLog(rows: readonly LeaderboardScoreRow[]): void {
    this.scored = new Uint8Array(this.totalPieces);
    this.perUser = new Map();
    for (const { pieceId, userId } of rows) {
      if (this.scored[pieceId]) continue;
      this.scored[pieceId] = 1;
      this.perUser.set(userId, (this.perUser.get(userId) ?? 0) + 1);
    }
  }

  // Credits userId with every pieceId not already scored by an earlier drop:
  // the first merge to ever drop a piece is the one that counts (see
  // DECISIONS), so a later re-drop of an already-scored piece (e.g. dragging
  // a cluster that already contains a previously-dropped piece) is a no-op
  // for that piece. O(pieceIds), the size of the group just dropped, never
  // the log. Returns how many pieces this drop actually credited, so the caller
  // can tell a merge that moved the standings from one that only re-dropped
  // already-scored pieces.
  recordDrop(userId: string, pieceIds: readonly number[]): number {
    let gained = 0;
    for (const id of pieceIds) {
      if (this.scored[id]) continue;
      this.scored[id] = 1;
      gained++;
    }
    if (gained > 0) this.perUser.set(userId, (this.perUser.get(userId) ?? 0) + gained);
    return gained;
  }

  // Move one user's tally onto another, for a guest folded into the account that
  // claimed it: the merge rows change hands in Mongo, and the live standings have
  // to follow without paying a rebuild. O(1), and a no-op for a guest that never
  // scored.
  reassign(fromUserId: string, toUserId: string): void {
    const gained = this.perUser.get(fromUserId);
    if (gained === undefined) return;
    this.perUser.delete(fromUserId);
    this.perUser.set(toUserId, (this.perUser.get(toUserId) ?? 0) + gained);
  }

  // Highest-first standings (see compareStandings). O(active users log limit),
  // never the log.
  top(limit: number): LeaderboardStanding[] {
    return [...this.perUser.entries()]
      .map(([userId, pieces]) => ({ userId, pieces }))
      .sort(compareStandings)
      .slice(0, limit);
  }

  // Tally plus competition rank for a batch of contributors: one sort of the
  // tallies for the whole batch, then a binary search each, rather than a full
  // scan per contributor. Feeds the personal standing sent to a contributor
  // ranked outside the broadcast top N. A contributor who has never scored has
  // no standing and is absent from the result.
  standingsFor(userIds: Iterable<string>): Map<string, RankedStanding> {
    const out = new Map<string, RankedStanding>();
    const wanted = [...new Set(userIds)].filter((id) => this.perUser.has(id));
    if (wanted.length === 0) return out;
    const descending = [...this.perUser.values()].sort((a, b) => b - a);
    for (const userId of wanted) {
      const pieces = this.perUser.get(userId)!;
      out.set(userId, { userId, pieces, rank: countAbove(descending, pieces) + 1 });
    }
    return out;
  }
}
