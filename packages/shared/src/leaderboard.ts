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
  // the log.
  recordDrop(userId: string, pieceIds: readonly number[]): void {
    let gained = 0;
    for (const id of pieceIds) {
      if (this.scored[id]) continue;
      this.scored[id] = 1;
      gained++;
    }
    if (gained > 0) this.perUser.set(userId, (this.perUser.get(userId) ?? 0) + gained);
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

  // Highest-first standings, ties broken by userId ascending (matches the
  // Mongo aggregation's own sort). O(active users log limit), never the log.
  top(limit: number): LeaderboardStanding[] {
    return [...this.perUser.entries()]
      .map(([userId, pieces]) => ({ userId, pieces }))
      .sort((a, b) => b.pieces - a.pieces || (a.userId < b.userId ? -1 : 1))
      .slice(0, limit);
  }
}
