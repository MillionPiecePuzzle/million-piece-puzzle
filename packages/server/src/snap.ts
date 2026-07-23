import type { GroupRuntime } from "@mpp/shared";
import type { RedisState } from "./state.js";

export type SnapMatch = {
  matchedGroupIds: number[];
  targetWorldX: number;
  targetWorldY: number;
  // True when a grid-neighbor of the drop is already locked: the whole drop
  // anchors to the frame, not just merges loose groups together.
  anchored: boolean;
  // Combined size of the groups behind matchedGroupIds, so a caller can weigh a
  // merge against a cap without a second read (see MPP_CLUSTER_PIECE_CAP).
  matchedSize: number;
};

export async function detectSnap(
  state: RedisState,
  rows: number,
  cols: number,
  snapTolerance: number,
  droppedGroup: GroupRuntime,
  droppedPieceIds: number[],
): Promise<SnapMatch | null> {
  const droppedPieceSet = new Set(droppedPieceIds);
  const candidates = new Map<number, GroupRuntime>();
  // A locked neighbor is always exactly at its solved position (no stored
  // position to read or compare), so the only thing left to check is whether
  // this drop itself landed close enough to its own solved position for that
  // adjacency to be a deliberate snap rather than a coincidence of ids. Same
  // tolerance test handleDrop calls frameAnchor, evaluated once here since it
  // does not vary per neighbor.
  const dropAtOrigin =
    Math.abs(droppedGroup.worldX) <= snapTolerance &&
    Math.abs(droppedGroup.worldY) <= snapTolerance;
  let touchesLocked = false;

  for (const pieceId of droppedPieceIds) {
    const row = Math.floor(pieceId / cols);
    const col = pieceId % cols;
    const neighborIds: number[] = [];
    if (row > 0) neighborIds.push((row - 1) * cols + col);
    if (row < rows - 1) neighborIds.push((row + 1) * cols + col);
    if (col > 0) neighborIds.push(row * cols + (col - 1));
    if (col < cols - 1) neighborIds.push(row * cols + (col + 1));

    for (const nId of neighborIds) {
      if (droppedPieceSet.has(nId)) continue;
      const nPiece = await state.readPieceState(nId);
      // A locked piece has no group (see DECISIONS: locked pieces stop being a
      // group), so this has to short-circuit here instead of resolving
      // piece.groupId -> group.locked, which would no longer find anything.
      if (nPiece.locked) {
        if (dropAtOrigin) touchesLocked = true;
        continue;
      }
      const nGroupId = nPiece.groupId;
      if (nGroupId === null || nGroupId === droppedGroup.id) continue;
      if (candidates.has(nGroupId)) continue;
      const nGroup = await state.readGroup(nGroupId);
      if (!nGroup) continue;
      // An actively-held cluster belongs to its holder until they drop it, and
      // its stored position is frozen at grab time (drag never persists), so it
      // is not a valid merge target: snapping onto it would yank it out of the
      // holder's hand at a stale position. The join still happens when the
      // holder drops, where their own detectSnap re-checks alignment.
      if (nGroup.heldBy !== null) continue;
      if (
        Math.abs(nGroup.worldX - droppedGroup.worldX) <= snapTolerance &&
        Math.abs(nGroup.worldY - droppedGroup.worldY) <= snapTolerance
      ) {
        candidates.set(nGroupId, nGroup);
      }
    }
  }

  if (candidates.size === 0 && !touchesLocked) return null;

  const values = [...candidates.values()];
  // A locked neighbor's implicit position (0,0), when present, takes priority
  // as the merge target over an arbitrary loose candidate: the same priority
  // the old code gave a locked GroupRuntime found among the candidates.
  const target = touchesLocked ? { worldX: 0, worldY: 0 } : values[0]!;

  // Each candidate is within tolerance of the dropped group, but two candidates
  // can each clear that bar while being up to 2 * snapTolerance apart from each
  // other (and from the target the merge snaps everything onto). Keep only the
  // candidates actually aligned with the target so the merged cluster stays
  // coherent instead of force-aligning groups that never matched.
  const matched = values.filter(
    (g) =>
      Math.abs(g.worldX - target.worldX) <= snapTolerance &&
      Math.abs(g.worldY - target.worldY) <= snapTolerance,
  );

  return {
    matchedGroupIds: matched.map((g) => g.id),
    targetWorldX: target.worldX,
    targetWorldY: target.worldY,
    anchored: touchesLocked,
    matchedSize: matched.reduce((sum, g) => sum + g.size, 0),
  };
}
