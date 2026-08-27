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
  // Tile margin from the manifest: how far past its grid cell a piece's artwork
  // reaches on every side, which is what the client sizes a cluster by.
  pieceMargin: number;
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
  const { groupIndex, lockedPieces, playZone, pieceSize, pieceMargin, tilePieceCap } = indexes;
  const { groupId, localAabb, size } = cluster;
  const gap = pieceSize * FLAG_DROP_GAP_PIECES;
  // The client searches with the bounds it draws, which run one tile margin past
  // the grid cell on every side (where a tab reaches), while both indexes here
  // hold the grid box alone. So the cluster is grown by the margin, which is what
  // keeps the spacing between landed pieces identical on both ends, and every
  // occupancy query is grown by it again to stand in for the margin its
  // neighbours' own stored boxes are missing.
  const bounds = grow(localAabb, pieceMargin);
  const occupied = (box: Aabb): boolean => {
    const query = grow(box, pieceMargin);
    return groupIndex.overlapsBox(query, groupId) || lockedPieces.overlapsBox(query);
  };
  return findFreeOrigin({
    bounds,
    atX: clamp(atX, playZone.minX, playZone.maxX),
    atY: clamp(atY, playZone.minY, playZone.maxY),
    gap,
    maxRing: FLAG_DROP_SEARCH_RINGS,
    clamp: (x, y) => ({
      x: clamp(x, playZone.minX - bounds.minX, playZone.maxX - bounds.maxX),
      y: clamp(y, playZone.minY - bounds.minY, playZone.maxY - bounds.maxY),
    }),
    isClear: (box) => !occupied(box),
    // The candidate box carries the margin and the clearance gap on every side, so
    // the tile asked is the one holding the cluster's own grid top-left corner:
    // the cell handleDrop counts against the cap when it commits the drop.
    hasRoom: (box) =>
      groupIndex.cellPieceCount(
        box.minX + gap + pieceMargin,
        box.minY + gap + pieceMargin,
        groupId,
      ) +
        size <=
      tilePieceCap,
  });
}

function grow(box: Aabb, by: number): Aabb {
  return {
    minX: box.minX - by,
    minY: box.minY - by,
    maxX: box.maxX + by,
    maxY: box.maxY + by,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
