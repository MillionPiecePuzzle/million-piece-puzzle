/**
 * Persistent data model (MongoDB).
 *
 * ObjectId fields are represented as hex strings in shared types. The server
 * maps them to/from BSON ObjectId at the storage boundary.
 *
 * Required indexes:
 *   users.pseudo                              unique
 *   cluster_merges (puzzleId, at)             timelapse replay
 *   cluster_merges (puzzleId, droppedPieceIds) per-piece attribution
 * Auth.js adapter manages its own collections (accounts, sessions) and their indexes.
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

export type User = {
  _id: string;
  pseudo: string;
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
