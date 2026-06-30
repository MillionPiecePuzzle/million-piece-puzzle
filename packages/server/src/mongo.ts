import { ObjectId, type Collection, type Db } from "mongodb";
import type { ActivityItem, ClusterMerge, LeaderboardEntry } from "@mpp/shared";

export type ClusterMergeDoc = Omit<ClusterMerge, "_id">;

// User document: either a guest (minted by createGuest, no email, carries
// claimTokenHash) or a Google account written by the Auth.js Mongo adapter (OAuth
// profile). Both carry the fields this app adds: pseudo and country, createdAt,
// lastSeenAt.
type UserDoc = {
  _id: ObjectId;
  guest?: boolean;
  email?: string;
  name?: string | null;
  image?: string | null;
  pseudo?: string | null;
  country?: string | null;
  claimTokenHash?: string | null;
  createdAt?: Date;
  lastSeenAt?: Date;
};

// Public-facing profile returned to the SPA after a guest mint or a pseudo /
// country update. guest lets the client show the account-sync affordance to a
// guest and hide it for a Google account.
export type UserProfile = {
  id: string;
  guest: boolean;
  name: string | null;
  image: string | null;
  pseudo: string | null;
  country: string | null;
};

// Outcome of POST /guest/claim, mapped to an HTTP status by the route. "self" is
// a caller trying to claim its own guest session; "not_found" is an unknown or
// already-claimed token (indistinguishable once the guest doc is deleted).
export type ClaimResult =
  | { status: "ok"; user: UserProfile }
  | { status: "not_found" }
  | { status: "self" };

// Thrown by setPseudo when the chosen pseudo is already taken (Mongo duplicate
// key on the partial-unique index). The route maps it to a 409.
export class DuplicatePseudoError extends Error {
  constructor() {
    super("pseudo already taken");
    this.name = "DuplicatePseudoError";
  }
}

const MONGO_DUPLICATE_KEY = 11000;

// Resolve a user id string to its public profile fields (pseudo, country),
// tolerant of ids that are not valid ObjectIds (dev/test data): a non-castable
// id simply yields no match instead of throwing inside the aggregation.
const profileLookup = (localField: string) => ({
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
      { $project: { _id: 0, pseudo: 1, country: 1 } },
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

  // Most recent merges for a puzzle, newest first, to backfill a joining client's
  // activity feed. Includes both snaps (not anchored) and places (anchored) so the
  // seeded feed shows the same event mix as the live stream. Each item's pseudo is
  // resolved from the user profile so backfilled items show names like the live feed.
  async recentMerges(puzzleId: string, limit: number): Promise<ActivityItem[]> {
    const docs = await this.merges
      .aggregate<{
        _id: ObjectId;
        userId: string;
        droppedPieceIds: number[];
        anchored: boolean;
        mergedSize?: number;
        at: Date;
        u: { pseudo?: string | null }[];
      }>([
        { $match: { puzzleId } },
        { $sort: { at: -1 } },
        { $limit: limit },
        profileLookup("userId"),
      ])
      .toArray();
    return docs.map((d) => {
      const droppedSize = Math.max(1, d.droppedPieceIds.length);
      return {
        id: d._id.toString(),
        userId: d.userId,
        pseudo: d.u[0]?.pseudo ?? null,
        anchored: d.anchored,
        droppedSize,
        // Docs written before mergedSize existed fall back to a >= 2 lower bound.
        mergedSize: d.mergedSize ?? Math.max(2, droppedSize + 1),
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
        u: { pseudo?: string | null; country?: string | null }[];
      }>([
        { $match: { puzzleId } },
        { $sort: { at: 1 } },
        { $unwind: "$droppedPieceIds" },
        { $group: { _id: "$droppedPieceIds", userId: { $first: "$userId" } } },
        { $group: { _id: "$userId", pieces: { $sum: 1 } } },
        { $sort: { pieces: -1, _id: 1 } },
        { $limit: limit },
        profileLookup("_id"),
      ])
      .toArray();
    return rows.map((r) => ({
      userId: r._id,
      pseudo: r.u[0]?.pseudo ?? null,
      country: r.u[0]?.country ?? null,
      pieces: r.pieces,
    }));
  }

  // First and last merge timestamps (ms) for a puzzle: two point lookups served
  // by the `puzzleId_at` index, so cheap regardless of log size. Null when nothing
  // has been placed yet. Drives the completed landing's recap date and event span.
  async puzzleSpan(puzzleId: string): Promise<{ firstAt: number; lastAt: number } | null> {
    const [first, last] = await Promise.all([
      this.merges.find({ puzzleId }).sort({ at: 1 }).limit(1).next(),
      this.merges.find({ puzzleId }).sort({ at: -1 }).limit(1).next(),
    ]);
    if (!first || !last) return null;
    return { firstAt: first.at.getTime(), lastAt: last.at.getTime() };
  }

  // Mint a guest: a real User with guest:true, the chosen pseudo and country, no
  // email, and the claim token hash. The pseudo passes through the same
  // partial-unique index as a Google account's, so a taken pseudo surfaces the
  // same DuplicatePseudoError (the route maps it to 409). Returns the new id (for
  // the session) and the public profile.
  async createGuest(input: {
    pseudo: string;
    country: string;
    claimTokenHash: string;
  }): Promise<{ id: string; user: UserProfile }> {
    const now = new Date();
    const doc: UserDoc = {
      _id: new ObjectId(),
      guest: true,
      pseudo: input.pseudo,
      country: input.country,
      claimTokenHash: input.claimTokenHash,
      createdAt: now,
      lastSeenAt: now,
    };
    try {
      await this.users.insertOne(doc);
    } catch (e) {
      if ((e as { code?: number }).code === MONGO_DUPLICATE_KEY) throw new DuplicatePseudoError();
      throw e;
    }
    return { id: doc._id.toString(), user: toProfile(doc) };
  }

  // Fold a guest into a signed-in user: verify the claim token, move the guest's
  // cluster_merges onto the target, overwrite the target's pseudo/country with the
  // guest's, and delete the guest. The findOneAndDelete keyed by the guest _id is
  // the concurrency lock, so two concurrent claims of one token cannot both
  // reattribute (the loser reads a gone doc). A self-claim (the caller is the
  // guest) is rejected before any delete, so the caller never deletes its own
  // account. Deleting the guest before setting its pseudo on the target frees the
  // pseudo first, so the carry-over cannot transiently collide on the
  // partial-unique index.
  async claimGuest(targetUserId: string, claimTokenHash: string): Promise<ClaimResult> {
    const guest = await this.users.findOne({ claimTokenHash, guest: true });
    if (!guest) return { status: "not_found" };
    if (guest._id.toString() === targetUserId) return { status: "self" };
    const deleted = await this.users.findOneAndDelete({
      _id: guest._id,
      claimTokenHash,
      guest: true,
    });
    if (!deleted) return { status: "not_found" };
    const guestId = deleted._id.toString();
    await this.merges.updateMany({ userId: guestId }, { $set: { userId: targetUserId } });
    const target = await this.users.findOneAndUpdate(
      { _id: new ObjectId(targetUserId) },
      { $set: { pseudo: deleted.pseudo ?? null, country: deleted.country ?? null } },
      { returnDocument: "after" },
    );
    if (!target) throw new Error(`claim target ${targetUserId} not found`);
    return { status: "ok", user: toProfile(target) };
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

  // Set a contributor's country (ISO 3166-1 alpha-2). No uniqueness constraint:
  // many contributors share a country.
  async setCountry(userId: string, country: string): Promise<UserProfile> {
    const doc = await this.users.findOneAndUpdate(
      { _id: new ObjectId(userId) },
      { $set: { country } },
      { returnDocument: "after" },
    );
    if (!doc) throw new Error(`user ${userId} not found`);
    return toProfile(doc);
  }

  // Fire-and-forget liveness stamp, written on each WS upgrade.
  async touchLastSeen(userId: string): Promise<void> {
    await this.users.updateOne({ _id: new ObjectId(userId) }, { $set: { lastSeenAt: new Date() } });
  }
}

function toProfile(doc: UserDoc): UserProfile {
  return {
    id: doc._id.toString(),
    guest: doc.guest ?? false,
    name: doc.name ?? null,
    image: doc.image ?? null,
    pseudo: doc.pseudo ?? null,
    country: doc.country ?? null,
  };
}

// Create every index the app and the Auth.js adapter depend on. The adapter
// creates the documents but not their indexes, so they are ensured here at boot.
export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("cluster_merges").createIndexes([
    { key: { puzzleId: 1, at: 1 }, name: "puzzleId_at" },
    { key: { puzzleId: 1, droppedPieceIds: 1 }, name: "puzzleId_droppedPieces" },
  ]);
  // email was a plain unique index before guests existed. Guests have no email,
  // so it becomes partial-unique (only docs where email is a string).
  // createIndexes cannot redefine an existing index name with new options, so the
  // legacy non-partial index is dropped first: a no-op on a fresh DB or once it is
  // already partial.
  const users = db.collection("users");
  try {
    const emailIdx = (await users.indexes()).find(
      (i) => (i as { name?: string }).name === "email_unique",
    ) as { partialFilterExpression?: unknown } | undefined;
    if (emailIdx && !emailIdx.partialFilterExpression) await users.dropIndex("email_unique");
  } catch (e) {
    // NamespaceNotFound (the users collection does not exist yet) means there is
    // nothing to drop.
    if ((e as { code?: number }).code !== 26) throw e;
  }
  await users.createIndexes([
    {
      key: { pseudo: 1 },
      name: "pseudo_unique",
      unique: true,
      partialFilterExpression: { pseudo: { $type: "string" } },
    },
    {
      key: { email: 1 },
      name: "email_unique",
      unique: true,
      partialFilterExpression: { email: { $type: "string" } },
    },
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
