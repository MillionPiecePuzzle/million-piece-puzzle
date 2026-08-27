// Where a cluster dropped on a HUD flag actually lands. The client runs the same
// outward search (see @mpp/shared freeSpot) against the board it has streamed,
// which is nothing at all under a flag planted in a region it never visited, so
// its answer is only the optimistic placement the authoritative drop corrects.
// Here the same rings are walked against the server's own complete state: every
// group's body rectangle (GroupIndex), every locked piece (LockedPieceIndex), and
// the destination tile's piece cap, which the search treats as a hard constraint
// so the drop lands in a tile with room instead of bouncing back to where the
// cluster was picked up.

import {
  FLAG_DROP_GAP_PIECES,
  FLAG_DROP_SEARCH_RINGS,
  findFreeOrigin,
  type PlayZone,
} from "@mpp/shared";
import type { GroupIndex } from "./groupIndex.js";
import type { LockedPieceIndex } from "./lockedPieces.js";
import type { Aabb } from "./worldGrid.js";

export type DropNearIndexes = {
  groupIndex: GroupIndex;
  lockedPieces: LockedPieceIndex;
  playZone: PlayZone;
  pieceSize: number;
  tilePieceCap: number;
};

export type DropNearCluster = {
  groupId: number;
  // Cluster bounds relative to its own origin, which is what the search returns.
  localAabb: Aabb;
  size: number;
};

// Internal origin the cluster should rest at, centered on the free patch nearest
// (atX, atY). The target point is clamped into the play zone first: a point far
// outside it would otherwise send every candidate to the same clamped corner.
export function resolveDropNearOrigin(
  indexes: DropNearIndexes,
  cluster: DropNearCluster,
  atX: number,
  atY: number,
): { x: number; y: number } {
  const { groupIndex, lockedPieces, playZone, pieceSize, tilePieceCap } = indexes;
  const { groupId, localAabb, size } = cluster;
  const gap = pieceSize * FLAG_DROP_GAP_PIECES;
  return findFreeOrigin({
    bounds: localAabb,
    atX: clamp(atX, playZone.minX, playZone.maxX),
    atY: clamp(atY, playZone.minY, playZone.maxY),
    gap,
    maxRing: FLAG_DROP_SEARCH_RINGS,
    clamp: (x, y) => ({
      x: clamp(x, playZone.minX - localAabb.minX, playZone.maxX - localAabb.maxX),
      y: clamp(y, playZone.minY - localAabb.minY, playZone.maxY - localAabb.maxY),
    }),
    isClear: (box) => !groupIndex.overlapsBox(box, groupId) && !lockedPieces.overlapsBox(box),
    // The candidate box carries the clearance gap on every side, so the tile asked
    // is the one holding the cluster's own top-left corner: the cell handleDrop
    // counts against the cap when it commits the drop.
    hasRoom: (box) =>
      groupIndex.cellPieceCount(box.minX + gap, box.minY + gap, groupId) + size <= tilePieceCap,
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
