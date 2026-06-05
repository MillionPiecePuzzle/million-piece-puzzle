/**
 * Redis key patterns for live puzzle state.
 *
 * A piece's absolute position is derived: group.worldX + canonicalOffset(pieceId).x
 * (and .y). It is never stored per piece.
 */

/** Hash: totalPieces, gridRows, gridCols, pieceSize, snapTolerance, generationSeed, status, startedAt. */
export const puzzleMeta = (puzzleId: string) => `puzzle:${puzzleId}:meta`;

/** Hash: groupId, rotation. */
export const piece = (puzzleId: string, pieceId: number) => `puzzle:${puzzleId}:piece:${pieceId}`;

/** Hash: worldX, worldY, locked, size, heldBy. */
export const group = (puzzleId: string, groupId: number) => `puzzle:${puzzleId}:group:${groupId}`;

/** Set: pieceIds belonging to the group. */
export const groupPieces = (puzzleId: string, groupId: number) =>
  `puzzle:${puzzleId}:group-pieces:${groupId}`;

/** Integer: atomic counter of locked pieces, broadcast for live progress. */
export const lockedCount = (puzzleId: string) => `puzzle:${puzzleId}:locked-count`;

/**
 * Stream: ordered log of spectator-visible drops and snaps. Each entry holds the
 * event JSON in one field; the auto-assigned id (`<ms>-<n>`) is the event `seq`,
 * and its ms component is the wall-clock window key the spectator stream reads by.
 */
export const events = (puzzleId: string) => `puzzle:${puzzleId}:events`;

/** Hash: userId -> viewportX, viewportY, zoom, lastSeenAt. */
export const presence = (puzzleId: string) => `puzzle:${puzzleId}:presence`;

/** Integer with TTL: per-IP fixed-window counter for an auth-route rate bucket. */
export const authRate = (bucket: string, ip: string) => `ratelimit:${bucket}:${ip}`;
