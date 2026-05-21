import { MongoClient, type Collection, type Db } from "mongodb";
import type { ActivityItem, ClusterMerge, LeaderboardEntry } from "@mpp/shared";

export type ClusterMergeDoc = Omit<ClusterMerge, "_id">;

export class MongoLogger {
  private client: MongoClient;
  private db!: Db;
  private merges!: Collection<ClusterMergeDoc>;

  constructor(
    private readonly url: string,
    private readonly dbName: string,
  ) {
    this.client = new MongoClient(url);
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.merges = this.db.collection<ClusterMergeDoc>("cluster_merges");
    await this.merges.createIndexes([
      { key: { puzzleId: 1, at: 1 }, name: "puzzleId_at" },
      { key: { puzzleId: 1, droppedPieceIds: 1 }, name: "puzzleId_droppedPieces" },
    ]);
  }

  async logMerge(doc: ClusterMergeDoc): Promise<void> {
    await this.merges.insertOne(doc);
  }

  // Most recent anchoring merges for a puzzle, newest first, to backfill a
  // joining client's activity feed.
  async recentAnchoredMerges(puzzleId: string, limit: number): Promise<ActivityItem[]> {
    const docs = await this.merges
      .find({ puzzleId, anchored: true })
      .sort({ at: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => {
      // Docs written before lockedDelta existed fall back to a piece count.
      const delta = (d.lockedDelta as number | undefined) ?? d.addedPieceIds.length;
      return {
        id: d._id.toString(),
        userId: d.userId,
        lockedDelta: Math.max(1, delta),
        at: d.at.getTime(),
      };
    });
  }

  // Per-user contribution standings, derived on demand. Each piece scores one
  // point for the user of the first merge (by `at`) that dragged it; every
  // piece is dragged at least once on its way to its solved position, so
  // per-user totals sum to the puzzle's piece count. The `puzzleId_at` index
  // serves the match-then-sort; the unwind and grouping that follow are a full
  // scan, re-run on every anchoring snap to keep the in-game leaderboard live,
  // acceptable at alpha scale.
  async leaderboard(puzzleId: string, limit: number): Promise<LeaderboardEntry[]> {
    const pipeline = [
      { $match: { puzzleId } },
      { $sort: { at: 1 } },
      { $unwind: "$droppedPieceIds" },
      { $group: { _id: "$droppedPieceIds", userId: { $first: "$userId" } } },
      { $group: { _id: "$userId", pieces: { $sum: 1 } } },
      { $sort: { pieces: -1, _id: 1 } },
      { $limit: limit },
    ];
    const rows = await this.merges.aggregate<{ _id: string; pieces: number }>(pipeline).toArray();
    return rows.map((r) => ({ userId: r._id, pieces: r.pieces }));
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
