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

/** Hash: userId -> viewportX, viewportY, zoom, lastSeenAt. */
export const presence = (puzzleId: string) => `puzzle:${puzzleId}:presence`;

/** Integer with TTL: per-IP fixed-window counter for a named rate bucket (auth routes, public landing). */
export const rateLimit = (bucket: string, ip: string) => `ratelimit:${bucket}:${ip}`;

/**
 * Set: one HMAC-hashed visitor IP per "I'm interested" opt-in. The count is the
 * set cardinality (SCARD), inherently unique per IP with no separate counter, and
 * "me" is a membership check (SISMEMBER). IPs are hashed, not stored raw, because
 * this set has no TTL (unlike the per-IP rate-limit keys above).
 */
export const interested = (puzzleId: string) => `puzzle:${puzzleId}:interested`;

/**
 * String (JSON {puzzleId, seed}): admin-set puzzle override, read at boot to
 * supersede the env puzzle so a switch survives the restart it triggers. Not
 * puzzle-scoped (it selects the puzzle). Cleared by a full admin wipe (FLUSHDB),
 * which intentionally returns the boot to the env baseline puzzle.
 */
export const adminPuzzleOverride = () => `admin:puzzle-override`;

/**
 * String (unix ms): admin-set event start, read at boot to supersede
 * MPP_EVENT_STARTS_AT. Cleared by a full admin wipe (FLUSHDB).
 */
export const adminEventStart = () => `admin:event-start`;
