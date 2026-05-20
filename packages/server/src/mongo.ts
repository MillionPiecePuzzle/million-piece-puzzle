import { MongoClient, type Collection, type Db } from "mongodb";
import type { ActivityItem, ClusterMerge } from "@mpp/shared";

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
      { key: { puzzleId: 1, addedPieceIds: 1 }, name: "puzzleId_addedPieces" },
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

  async close(): Promise<void> {
    await this.client.close();
  }
}
