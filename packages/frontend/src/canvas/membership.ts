// Pure membership planning for a snap (cluster merge), shared by the stage so the
// partial-board logic is unit-testable without mounting Pixi.
//
// Under protocol v3 a contributor's board is partial: only visited regions are
// built, so a snap can straddle the boundary (the merged host or some source
// groups were never seen). The plan a snap produces:
// - removeGroups: the KNOWN source groups, removed so no phantom survives a merge
//   the server applied (an unknown source contributes nothing to remove).
// - hostKnown: whether the surviving group is built on this client. When false the
//   merged cluster is constructed wholesale by the next region_state for its cell,
//   so the stage only reassigns membership and clears the known sources here.

export type SnapPlan = {
  hostKnown: boolean;
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
    hostKnown: knownGroups.has(newGroupId),
    removeGroups: [...removeGroups],
  };
}
