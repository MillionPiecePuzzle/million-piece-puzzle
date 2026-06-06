// The ordering guard for a pan resync (the `region_state` message). A region_state
// entry carries the server's last committed resting position for a group, so the
// client applies it only to a group it is not the live authority for: a group it
// is holding (localHeldId), a peer is holding (heldGroupIds), or one it just
// dropped and is awaiting the server's confirmation of (pendingDrops) all keep
// their newer local position. Every other group takes the resync; sequential
// application of any later live drag/drop/snap then stays correct, since those
// arrive in order on the connection and the server index is monotonic. Pure, so
// the guard is unit-tested without mounting Pixi.
export function resyncShouldApply(
  groupId: number,
  localHeldId: number | null,
  heldGroupIds: ReadonlySet<number>,
  pendingDrops: ReadonlySet<number>,
): boolean {
  if (groupId === localHeldId) return false;
  if (heldGroupIds.has(groupId)) return false;
  if (pendingDrops.has(groupId)) return false;
  return true;
}
