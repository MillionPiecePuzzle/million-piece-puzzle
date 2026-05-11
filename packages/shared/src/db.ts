/**
 * Persistent data model (MongoDB).
 *
 * ObjectId fields are represented as hex strings in shared types. The server
 * maps them to/from BSON ObjectId at the storage boundary.
 *
 * Required indexes:
 *   users.pseudo                            unique
 *   cluster_merges (puzzleId, at)           timelapse replay
 *   cluster_merges (puzzleId, addedPieceIds) per-piece attribution
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
  addedPieceIds: number[];
  targetAnchorPieceId: number;
  anchored: boolean;
  at: Date;
};
