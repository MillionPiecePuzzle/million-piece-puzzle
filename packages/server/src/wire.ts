/**
 * The wire boundary: the only place grid-id + internal-origin server state is
 * translated to and from the opaque wire representation a client sees.
 *
 * The server's whole model (Redis, the dispatch queues, snap-by-origin, the group
 * index, broadcast AABB scoping) stays in grid-id + internal-origin space. At the
 * edges:
 *  - outbound: gridId -> wireId (the seed permutation), and a group's internal
 *    origin -> the world position of its anchor piece (the cluster's min-id host,
 *    which equals the internal group id), plus a grid-unit (dx, dy) per member.
 *  - inbound: wireId -> gridId, and the client's anchor world position -> the
 *    internal origin, so handlers run exactly as before.
 *
 * Anchor world position: a piece renders at `origin + canonicalOffset(gridId)`
 * where canonicalOffset is its solved cell `(col * pieceSize, row * pieceSize)`.
 * The anchor is the group id, so its world position is
 * `origin + (anchorCol * pieceSize, anchorRow * pieceSize)`. A locked cluster has
 * origin (0, 0), so its anchor world position is its true solved position, which
 * is correct (placed and visible to all) and not a leak.
 */

import { buildPermutation, type WirePiece } from "@mpp/shared";

export type WireContext = {
  gridCols: number;
  pieceSize: number;
  wireForGrid: Int32Array;
  gridForWire: Int32Array;
};

export function buildWireContext(
  seed: string,
  totalPieces: number,
  gridCols: number,
  pieceSize: number,
): WireContext {
  const { wireForGrid, gridForWire } = buildPermutation(seed, totalPieces);
  return { gridCols, pieceSize, wireForGrid, gridForWire };
}

export function toWireId(ctx: WireContext, gridId: number): number {
  return ctx.wireForGrid[gridId]!;
}

export function toGridId(ctx: WireContext, wireId: number): number {
  return ctx.gridForWire[wireId]!;
}

function colOf(ctx: WireContext, gridId: number): number {
  return gridId % ctx.gridCols;
}

function rowOf(ctx: WireContext, gridId: number): number {
  return Math.floor(gridId / ctx.gridCols);
}

// World position of a group's anchor piece, from its internal origin. The anchor
// is the group id (the cluster's min-id host).
export function anchorWorldX(ctx: WireContext, gridGroupId: number, originX: number): number {
  return originX + colOf(ctx, gridGroupId) * ctx.pieceSize;
}

export function anchorWorldY(ctx: WireContext, gridGroupId: number, originY: number): number {
  return originY + rowOf(ctx, gridGroupId) * ctx.pieceSize;
}

// Inverse of anchorWorld*: the internal origin from a client's anchor world
// position. `originX = clientAnchorX - anchorCol * pieceSize`.
export function originXFromAnchor(ctx: WireContext, gridGroupId: number, anchorX: number): number {
  return anchorX - colOf(ctx, gridGroupId) * ctx.pieceSize;
}

export function originYFromAnchor(ctx: WireContext, gridGroupId: number, anchorY: number): number {
  return anchorY - rowOf(ctx, gridGroupId) * ctx.pieceSize;
}

// Member pieces encoded for the wire: each gets its opaque id and its grid-unit
// offset from the group anchor. `memberGridIds` are internal piece ids; the
// anchor is `gridGroupId`.
export function wirePieces(
  ctx: WireContext,
  gridGroupId: number,
  memberGridIds: readonly number[],
): WirePiece[] {
  const ac = colOf(ctx, gridGroupId);
  const ar = rowOf(ctx, gridGroupId);
  const out: WirePiece[] = [];
  for (const gid of memberGridIds) {
    out.push({ id: toWireId(ctx, gid), dx: colOf(ctx, gid) - ac, dy: rowOf(ctx, gid) - ar });
  }
  return out;
}
