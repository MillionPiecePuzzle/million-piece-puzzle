// Pure membership planning for a snap (cluster merge) and an anchor (a merge
// that locks), shared by the stage so the partial-board logic is unit-testable
// without mounting Pixi.
//
// Under protocol v3 a contributor's board is partial: only visited regions are
// built, so a snap can straddle the boundary (the merged host or some source
// groups were never seen). The plan a snap produces is the KNOWN source groups
// to remove, so no phantom survives a merge the server applied (an unknown
// source contributes nothing to remove).

import type { WirePiece } from "@mpp/shared";

export type SnapPlan = {
  removeGroups: number[];
};

// `knownGroups` is any membership test over built group ids (the stage passes its
// `groups` Map directly, so there is no per-snap allocation); `pieceToGroup` is
// the current piece -> group map. `addedPieces` are wire pieces (the offsets are
// not needed here, only the ids).
export type GroupMembership = { has(groupId: number): boolean };

export function resolveSnap(
  newGroupId: number,
  addedPieces: readonly { id: number }[],
  knownGroups: GroupMembership,
  pieceToGroup: ReadonlyMap<number, number>,
): SnapPlan {
  const removeGroups = new Set<number>();
  for (const { id: pieceId } of addedPieces) {
    const gid = pieceToGroup.get(pieceId);
    if (gid === newGroupId) continue;
    if (gid !== undefined && knownGroups.has(gid)) removeGroups.add(gid);
  }
  return {
    removeGroups: [...removeGroups],
  };
}

// An anchoring merge locks every piece it touches and dissolves every group it
// touches, whole (see DECISIONS: locked pieces stop being a group): unlike a
// loose snap there is no surviving host to reparent into. The plan groups the
// server's flat lockedPieceIds by each piece's current known owner, so the
// caller can salvage an already-hydrated member straight out of its dying
// group (reusing its texture) before destroying that group; a piece with no
// known owner (never visited, or its group's cell was never built) has
// nothing to salvage from and goes straight to a fresh locked-piece fetch.
export type AnchorPlan = {
  byGroup: Map<number, WirePiece[]>;
  ungrouped: WirePiece[];
};

export function resolveAnchor(
  lockedPieceIds: readonly WirePiece[],
  pieceToGroup: ReadonlyMap<number, number>,
): AnchorPlan {
  const byGroup = new Map<number, WirePiece[]>();
  const ungrouped: WirePiece[] = [];
  for (const wp of lockedPieceIds) {
    const gid = pieceToGroup.get(wp.id);
    if (gid === undefined) {
      ungrouped.push(wp);
      continue;
    }
    let list = byGroup.get(gid);
    if (!list) {
      list = [];
      byGroup.set(gid, list);
    }
    list.push(wp);
  }
  return { byGroup, ungrouped };
}
