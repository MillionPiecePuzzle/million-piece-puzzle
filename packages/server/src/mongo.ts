import { ObjectId, type Collection, type Db } from "mongodb";
import {
  PROFILE_COOLDOWN_MS,
  type ActivityItem,
  type ClusterMerge,
  type LeaderboardEntry,
  type LeaderboardScoreRow,
  type LeaderboardStanding,
} from "@mpp/shared";

export type ClusterMergeDoc = Omit<ClusterMerge, "_id">;

// User document: either a guest (minted by createGuest, no email, carries
// claimTokenHash) or a permanent account (email and OAuth profile, guest false),
// which is the same document once a Google account is linked to the guest's live
// session. Both carry the fields this app adds: pseudo and country, createdAt,
// lastSeenAt. pseudoChangedAt/countryChangedAt are set on a change (not the
// initial onboarding choice) and enforce PROFILE_COOLDOWN_MS.
type UserDoc = {
  _id: ObjectId;
  guest?: boolean;
  email?: string;
  name?: string | null;
  image?: string | null;
  pseudo?: string | null;
  country?: string | null;
  claimTokenHash?: string | null;
  pseudoChangedAt?: Date | null;
  countryChangedAt?: Date | null;
  createdAt?: Date;
  lastSeenAt?: Date;
};

// Public-facing profile returned to the SPA after a guest mint or a pseudo /
// country update. guest drives the options menu: the sync action for a guest, the
// synced state carrying email and name once a Google account is linked.
export type UserProfile = {
  id: string;
  guest: boolean;
  email: string | null;
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

// Thrown by setPseudo/setCountry when the caller already changed it within
// PROFILE_COOLDOWN_MS. retryAt is when the cooldown lifts. The route maps these
// to a 429.
export class PseudoCooldownError extends Error {
  constructor(public readonly retryAt: Date) {
    super("pseudo change is on cooldown");
    this.name = "PseudoCooldownError";
  }
}

export class CountryCooldownError extends Error {
  constructor(public readonly retryAt: Date) {
    super("country change is on cooldown");
    this.name = "CountryCooldownError";
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

  // Every piece's first scorer (see DECISIONS: leaderboard scoring): one row
  // per piece ever dropped or locked, the exact shape
  // LeaderboardTracker.rebuildFromLog needs to seed the live standings from
  // scratch. The two arrays are concatenated because applyMerge scores the
  // same union: droppedPieceIds on every merge, plus the whole locked set on
  // an anchoring one, so a piece that only ever sat on the receiving end still
  // gets an owner when it locks. Both come from one doc with one userId, so
  // their order inside it does not matter. Same match/sort/unwind/group shape
  // a per-merge aggregation would use, but paid once (boot, reset,
  // force-complete, the slow defense-in-depth resync) instead of on every
  // anchoring snap: re-running this full scan per snap degraded visibly once
  // the merge log grew past ~600 000 documents (a 995 000-piece lock run went
  // from 13 to 1.7 pieces/s), the exact per-event cost the incremental tracker
  // exists to avoid.
  async leaderboardScoreRows(puzzleId: string): Promise<LeaderboardScoreRow[]> {
    const rows = await this.merges
      .aggregate<{
        _id: number;
        userId: string;
      }>([
        { $match: { puzzleId } },
        { $sort: { at: 1 } },
        {
          $project: {
            userId: 1,
            scoredPieceIds: {
              $concatArrays: [
                { $ifNull: ["$droppedPieceIds", []] },
                { $ifNull: ["$lockedPieceIds", []] },
              ],
            },
          },
        },
        { $unwind: "$scoredPieceIds" },
        { $group: { _id: "$scoredPieceIds", userId: { $first: "$userId" } } },
      ])
      .toArray();
    return rows.map((r) => ({ pieceId: r._id, userId: r.userId }));
  }

  // Attaches pseudo/country to a bounded top-N standings list
  // (LeaderboardTracker.top), a plain $in lookup on just those userIds
  // (O(entries), never the merge log). Tolerant of a non-ObjectId userId
  // (dev/test data), the same posture profileLookup's $convert takes.
  async attachProfiles(entries: LeaderboardStanding[]): Promise<LeaderboardEntry[]> {
    const ids: ObjectId[] = [];
    for (const e of entries) {
      try {
        ids.push(new ObjectId(e.userId));
      } catch {
        // Not a valid ObjectId (dev/test data): no profile to attach.
      }
    }
    const profiles =
      ids.length > 0
        ? await this.users
            .find({ _id: { $in: ids } }, { projection: { pseudo: 1, country: 1 } })
            .toArray()
        : [];
    const byId = new Map(profiles.map((p) => [p._id.toString(), p]));
    return entries.map((e) => ({
      userId: e.userId,
      pseudo: byId.get(e.userId)?.pseudo ?? null,
      country: byId.get(e.userId)?.country ?? null,
      pieces: e.pieces,
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
  // partial-unique index. A duplicate surfaces as DuplicatePseudoError. The
  // initial onboarding choice (existing pseudo is null) is free and does not
  // start the cooldown; a change to an already-set pseudo is throttled to once
  // per PROFILE_COOLDOWN_MS, surfaced as PseudoCooldownError.
  async setPseudo(userId: string, pseudo: string): Promise<UserProfile> {
    const _id = new ObjectId(userId);
    const existing = await this.users.findOne({ _id });
    if (!existing) throw new Error(`user ${userId} not found`);
    const isChange = existing.pseudo != null;
    if (isChange && existing.pseudoChangedAt) {
      const retryAt = new Date(existing.pseudoChangedAt.getTime() + PROFILE_COOLDOWN_MS);
      if (retryAt.getTime() > Date.now()) throw new PseudoCooldownError(retryAt);
    }
    try {
      const doc = await this.users.findOneAndUpdate(
        { _id },
        { $set: { pseudo, ...(isChange ? { pseudoChangedAt: new Date() } : {}) } },
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
  // many contributors share a country. Same cooldown posture as setPseudo: the
  // initial onboarding choice is free, a later change is throttled.
  async setCountry(userId: string, country: string): Promise<UserProfile> {
    const _id = new ObjectId(userId);
    const existing = await this.users.findOne({ _id });
    if (!existing) throw new Error(`user ${userId} not found`);
    const isChange = existing.country != null;
    if (isChange && existing.countryChangedAt) {
      const retryAt = new Date(existing.countryChangedAt.getTime() + PROFILE_COOLDOWN_MS);
      if (retryAt.getTime() > Date.now()) throw new CountryCooldownError(retryAt);
    }
    const doc = await this.users.findOneAndUpdate(
      { _id },
      { $set: { country, ...(isChange ? { countryChangedAt: new Date() } : {}) } },
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
    email: doc.email ?? null,
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
