import type { GroupRuntime } from "@mpp/shared";
import type { GroupIndex } from "./groupIndex.js";
import type { RedisState } from "./state.js";

// What makes a target piece unreachable: the loose pieces piled on top of it (see
// DECISIONS: a buried piece is not a snap target). `max` is how many are tolerated
// before the snap onto that piece is refused, `index` the read model the count is
// walked against, both wired from config at boot.
export type SnapCover = {
  index: GroupIndex;
  pieceSize: number;
  max: number;
};

export type SnapResult = {
  match: SnapMatch | null;
  // A contact piece was refused for being buried and nothing else matched, so the
  // drop rests where it landed and its author is owed the notice explaining why.
  covered: boolean;
};

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
  cover: SnapCover,
): Promise<SnapResult> {
  const droppedPieceSet = new Set(droppedPieceIds);
  const candidates = new Map<number, GroupRuntime>();
  let blockedByCover = false;
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
        Math.abs(nGroup.worldX - droppedGroup.worldX) > snapTolerance ||
        Math.abs(nGroup.worldY - droppedGroup.worldY) > snapTolerance
      ) {
        continue;
      }
      // Checked last, on an already-aligned candidate, so the walk stays off the
      // ordinary drop path. A group reachable through several contact pieces is
      // still a target as long as one of them is in the open.
      if (await isBuried(state, cover, rows, cols, nId, nGroup, droppedGroup.id)) {
        blockedByCover = true;
        continue;
      }
      candidates.set(nGroupId, nGroup);
    }
  }

  if (candidates.size === 0 && !touchesLocked) return { match: null, covered: blockedByCover };

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
    match: {
      matchedGroupIds: matched.map((g) => g.id),
      targetWorldX: target.worldX,
      targetWorldY: target.worldY,
      anchored: touchesLocked,
      matchedSize: matched.reduce((sum, g) => sum + g.size, 0),
    },
    covered: false,
  };
}

// Whether more than `cover.max` other loose pieces stand on the centre of piece
// `pieceId`, the contact the drop would snap onto. The index answers in bounding
// boxes, so each candidate is resolved to the one piece of its group that covers
// the point (the grid is regular in solved space, so that is arithmetic) and kept
// only if the group really holds it: a cluster's box spans the gaps in its own
// shape, and counting those would refuse snaps next to any ragged cluster.
async function isBuried(
  state: RedisState,
  cover: SnapCover,
  rows: number,
  cols: number,
  pieceId: number,
  group: GroupRuntime,
  droppedGroupId: number,
): Promise<boolean> {
  const { index, pieceSize, max } = cover;
  const centerX = group.worldX + (pieceId % cols) * pieceSize + pieceSize / 2;
  const centerY = group.worldY + Math.floor(pieceId / cols) * pieceSize + pieceSize / 2;
  // The target's own group covers its own piece, and the dropped group is still
  // indexed at the position it was picked up from, which is no longer where it is.
  const except = new Set([group.id, droppedGroupId]);
  let count = 0;
  for (const candidate of index.groupsCoveringPoint(centerX, centerY, except, max + 1)) {
    const col = Math.floor((centerX - candidate.originX) / pieceSize);
    const row = Math.floor((centerY - candidate.originY) / pieceSize);
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
    const piece = await state.readPieceState(row * cols + col);
    if (piece.locked || piece.groupId !== candidate.groupId) continue;
    if (++count > max) return true;
  }
  return false;
}
