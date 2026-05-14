import type { GroupRuntime } from "@mpp/shared";
import type { RedisState } from "./state.js";

export type SnapMatch = {
  matchedGroupIds: number[];
  targetWorldX: number;
  targetWorldY: number;
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
      const nGroupId = await state.readPieceGroup(nId);
      if (nGroupId === null || nGroupId === droppedGroup.id) continue;
      if (candidates.has(nGroupId)) continue;
      const nGroup = await state.readGroup(nGroupId);
      if (!nGroup) continue;
      if (
        Math.abs(nGroup.worldX - droppedGroup.worldX) <= snapTolerance &&
        Math.abs(nGroup.worldY - droppedGroup.worldY) <= snapTolerance
      ) {
        candidates.set(nGroupId, nGroup);
      }
    }
  }

  if (candidates.size === 0) return null;

  const values = [...candidates.values()];
  const target = values.find((g) => g.locked) ?? values[0]!;

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
  };
}
