import { MongoClient, type Collection, type Db } from "mongodb";
import type { ClusterMerge } from "@mpp/shared";

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

  async close(): Promise<void> {
    await this.client.close();
  }
}
