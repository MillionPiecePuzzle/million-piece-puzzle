/**
 * Runtime piece and group types shared on the wire.
 *
 * Geometry (Bezier params, canonical offsets) is deterministic from the
 * puzzle's generationSeed and is recomputed client and server side. It is
 * never serialized in WS messages or stored in Redis.
 *
 * A piece's absolute world position is derived:
 *   worldX = group.worldX + canonicalOffset(pieceId).x
 *   worldY = group.worldY + canonicalOffset(pieceId).y
 */

export type PieceRuntime = {
  id: number;
  groupId: number;
  rotation: number;
};

export type GroupRuntime = {
  id: number;
  worldX: number;
  worldY: number;
  size: number;
  locked: boolean;
  heldBy: string | null;
};
