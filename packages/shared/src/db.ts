/**
 * Persistent data model (MongoDB).
 *
 * ObjectId fields are represented as hex strings in shared types. The server
 * maps them to/from BSON ObjectId at the storage boundary.
 *
 * The Auth.js Mongo adapter owns the shape of `users`, `accounts`, and
 * `sessions` (it creates the documents) but does NOT create their indexes, so
 * the server ensures them at boot (see server `ensureIndexes`):
 *   users.pseudo            partial-unique (only docs where pseudo is a string)
 *   users.email             unique
 *   accounts (provider, providerAccountId)    unique
 *   sessions.sessionToken   unique
 *   cluster_merges (puzzleId, at)             timelapse replay
 *   cluster_merges (puzzleId, droppedPieceIds) per-piece attribution
 */

export type PuzzleStatus = "draft" | "active" | "completed";

export type Puzzle = {
  _id: string;
  name: string;
  totalPieces: number;
  gridRows: number;
  gridCols: number;
  generationSeed: string;
  imageManifestUrl: string;
  status: PuzzleStatus;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

// Authenticated contributor. The OAuth profile fields (email, name, image) are
// written by the Auth.js adapter on first sign-in; pseudo is set later through
// the forced onboarding modal and is null until then. pseudo is the only
// public-facing identity, shown for snap attribution.
export type User = {
  _id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  emailVerified?: Date | null;
  pseudo: string | null;
  createdAt: Date;
  lastSeenAt: Date;
};

export type ClusterMerge = {
  _id: string;
  puzzleId: string;
  userId: string;
  // Pieces whose groupId changed in this merge: the pieces of every group
  // except the host (lowest group id). The client uses these to re-parent
  // sprites onto the merged group.
  addedPieceIds: number[];
  // Pieces of the group the user dragged in this merge. The basis for
  // contribution scoring: a piece is credited to the user of the first merge
  // that dragged it, the user who carried it toward its solved position.
  // Distinct from addedPieceIds, which follows group-id order, not drag
  // direction.
  droppedPieceIds: number[];
  targetAnchorPieceId: number;
  anchored: boolean;
  // Pieces this merge newly locked to the frame (0 for a non-anchoring merge).
  // Stored because it cannot be recomputed from a saved doc: a frame-anchored
  // cluster locks its pieces without listing any in addedPieceIds.
  lockedDelta: number;
  at: Date;
};
