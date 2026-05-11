/**
 * Redis key patterns for live puzzle state.
 *
 * A piece's absolute position is derived: group.worldX + canonicalOffset(pieceId, group).
 * It is never stored per piece.
 */

/** Hash: totalPieces, gridRows, gridCols, status, startedAt, generationSeed. */
export const puzzleMeta = (puzzleId: string) => `puzzle:${puzzleId}:meta`;

/** Hash: groupId, rotation. */
export const piece = (puzzleId: string, pieceId: number) =>
  `puzzle:${puzzleId}:piece:${pieceId}`;

/** Hash: worldX, worldY, locked, size, heldBy. */
export const group = (puzzleId: string, groupId: number) =>
  `puzzle:${puzzleId}:group:${groupId}`;

/** Set: pieceIds belonging to the group. */
export const groupPieces = (puzzleId: string, groupId: number) =>
  `puzzle:${puzzleId}:group-pieces:${groupId}`;

/** Integer: atomic counter of locked pieces, broadcast for live progress. */
export const lockedCount = (puzzleId: string) =>
  `puzzle:${puzzleId}:locked-count`;

/** Hash: userId -> viewportX, viewportY, zoom, lastSeenAt. */
export const presence = (puzzleId: string) => `puzzle:${puzzleId}:presence`;
