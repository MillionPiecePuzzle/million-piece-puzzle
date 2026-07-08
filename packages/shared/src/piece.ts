/**
 * Runtime piece and group types shared on the wire.
 *
 * The wire is opaque: ids are seed-permuted (`wireId = P(gridId)`, see
 * permutation.ts), and a group's position is the world position of its anchor
 * piece (the cluster's min-id host), not a solved-space origin. Each member piece
 * carries a grid-unit offset `(dx, dy)` from that anchor, so the client places it
 * without ever deriving a solved-space coordinate (no seed, no `id % cols`).
 *
 * A piece's absolute world position is:
 *   worldX = group.worldX + dx * pieceSize
 *   worldY = group.worldY + dy * pieceSize
 * The anchor itself has (dx, dy) = (0, 0); a locked cluster's anchor world
 * position is its true solved position (placed and visible to all, not a leak).
 */

// One member piece on a construction or snap message: its opaque id plus its
// grid-unit offset from the group anchor. Static intra-cluster structure, so it
// rides on construction/snap only, never on a per-frame drag.
export type WirePiece = {
  id: number;
  dx: number;
  dy: number;
};

export type GroupRuntime = {
  id: number;
  worldX: number;
  worldY: number;
  size: number;
  locked: boolean;
  heldBy: string | null;
};
