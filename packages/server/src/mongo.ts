import { ObjectId, type Collection, type Db } from "mongodb";
import type { ActivityItem, ClusterMerge, LeaderboardEntry } from "@mpp/shared";

export type ClusterMergeDoc = Omit<ClusterMerge, "_id">;

// User document as written by the Auth.js Mongo adapter (OAuth profile) plus the
// fields this app adds: pseudo (set through onboarding), createdAt, lastSeenAt.
type UserDoc = {
  _id: ObjectId;
  email?: string;
  name?: string | null;
  image?: string | null;
  pseudo?: string | null;
  createdAt?: Date;
  lastSeenAt?: Date;
};

// Public-facing profile returned to the SPA after a pseudo update.
export type UserProfile = {
  id: string;
  name: string | null;
  image: string | null;
  pseudo: string | null;
};

// Thrown by setPseudo when the chosen pseudo is already taken (Mongo duplicate
// key on the partial-unique index). The route maps it to a 409.
export class DuplicatePseudoError extends Error {
  constructor() {
    super("pseudo already taken");
    this.name = "DuplicatePseudoError";
  }
}

const MONGO_DUPLICATE_KEY = 11000;

// Resolve a user id string to its pseudo, tolerant of ids that are not valid
// ObjectIds (dev/test data): a non-castable id simply yields no match instead of
// throwing inside the aggregation.
const pseudoLookup = (localField: string) => ({
  $lookup: {
    from: "users",
    let: { uid: `$${localField}` },
    pipeline: [
      {
        $match: {
          $expr: {
            $eq: [
              "$_id",
              { $convert: { input: "$$uid", to: "objectId", onError: null, onNull: null } },
            ],
          },
        },
      },
      { $project: { _id: 0, pseudo: 1 } },
    ],
    as: "u",
  },
});

export class MongoLogger {
  private readonly merges: Collection<ClusterMergeDoc>;
  private readonly users: Collection<UserDoc>;

  constructor(private readonly db: Db) {
    this.merges = db.collection<ClusterMergeDoc>("cluster_merges");
    this.users = db.collection<UserDoc>("users");
  }

  async logMerge(doc: ClusterMergeDoc): Promise<void> {
    await this.merges.insertOne(doc);
  }

  // Drop a puzzle's entire merge log. Called on reset so the derived leaderboard
  // and activity feed start empty for the fresh board.
  async clearPuzzle(puzzleId: string): Promise<void> {
    await this.merges.deleteMany({ puzzleId });
  }

  // Most recent anchoring merges for a puzzle, newest first, to backfill a
  // joining client's activity feed. Each item's pseudo is resolved from the user
  // profile so backfilled placements show names like the live feed.
  async recentAnchoredMerges(puzzleId: string, limit: number): Promise<ActivityItem[]> {
    const docs = await this.merges
      .aggregate<{
        _id: ObjectId;
        userId: string;
        addedPieceIds: number[];
        lockedDelta?: number;
        at: Date;
        u: { pseudo?: string | null }[];
      }>([
        { $match: { puzzleId, anchored: true } },
        { $sort: { at: -1 } },
        { $limit: limit },
        pseudoLookup("userId"),
      ])
      .toArray();
    return docs.map((d) => {
      // Docs written before lockedDelta existed fall back to a piece count.
      const delta = d.lockedDelta ?? d.addedPieceIds.length;
      return {
        id: d._id.toString(),
        userId: d.userId,
        pseudo: d.u[0]?.pseudo ?? null,
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
  // acceptable at alpha scale. A final lookup attaches each user's pseudo.
  async leaderboard(puzzleId: string, limit: number): Promise<LeaderboardEntry[]> {
    const rows = await this.merges
      .aggregate<{
        _id: string;
        pieces: number;
        u: { pseudo?: string | null }[];
      }>([
        { $match: { puzzleId } },
        { $sort: { at: 1 } },
        { $unwind: "$droppedPieceIds" },
        { $group: { _id: "$droppedPieceIds", userId: { $first: "$userId" } } },
        { $group: { _id: "$userId", pieces: { $sum: 1 } } },
        { $sort: { pieces: -1, _id: 1 } },
        { $limit: limit },
        pseudoLookup("_id"),
      ])
      .toArray();
    return rows.map((r) => ({ userId: r._id, pseudo: r.u[0]?.pseudo ?? null, pieces: r.pieces }));
  }

  // Set a contributor's pseudo, enforcing global uniqueness through the
  // partial-unique index. A duplicate surfaces as DuplicatePseudoError.
  async setPseudo(userId: string, pseudo: string): Promise<UserProfile> {
    try {
      const doc = await this.users.findOneAndUpdate(
        { _id: new ObjectId(userId) },
        { $set: { pseudo } },
        { returnDocument: "after" },
      );
      if (!doc) throw new Error(`user ${userId} not found`);
      return toProfile(doc);
    } catch (e) {
      if ((e as { code?: number }).code === MONGO_DUPLICATE_KEY) throw new DuplicatePseudoError();
      throw e;
    }
  }

  // Fire-and-forget liveness stamp, written on each WS upgrade.
  async touchLastSeen(userId: string): Promise<void> {
    await this.users.updateOne({ _id: new ObjectId(userId) }, { $set: { lastSeenAt: new Date() } });
  }
}

function toProfile(doc: UserDoc): UserProfile {
  return {
    id: doc._id.toString(),
    name: doc.name ?? null,
    image: doc.image ?? null,
    pseudo: doc.pseudo ?? null,
  };
}

// Create every index the app and the Auth.js adapter depend on. The adapter
// creates the documents but not their indexes, so they are ensured here at boot.
export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("cluster_merges").createIndexes([
    { key: { puzzleId: 1, at: 1 }, name: "puzzleId_at" },
    { key: { puzzleId: 1, droppedPieceIds: 1 }, name: "puzzleId_droppedPieces" },
  ]);
  await db.collection("users").createIndexes([
    {
      key: { pseudo: 1 },
      name: "pseudo_unique",
      unique: true,
      partialFilterExpression: { pseudo: { $type: "string" } },
    },
    { key: { email: 1 }, name: "email_unique", unique: true },
  ]);
  await db
    .collection("accounts")
    .createIndex(
      { provider: 1, providerAccountId: 1 },
      { name: "provider_account_unique", unique: true },
    );
  await db
    .collection("sessions")
    .createIndex({ sessionToken: 1 }, { name: "sessionToken_unique", unique: true });
}
