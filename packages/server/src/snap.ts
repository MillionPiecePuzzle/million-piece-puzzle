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
  const matched = new Map<number, GroupRuntime>();

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
      if (matched.has(nGroupId)) continue;
      const nGroup = await state.readGroup(nGroupId);
      if (!nGroup) continue;
      if (
        Math.abs(nGroup.worldX - droppedGroup.worldX) <= snapTolerance &&
        Math.abs(nGroup.worldY - droppedGroup.worldY) <= snapTolerance
      ) {
        matched.set(nGroupId, nGroup);
      }
    }
  }

  if (matched.size === 0) return null;

  const values = [...matched.values()];
  let target = values[0]!;
  for (const g of values) {
    if (g.locked) {
      target = g;
      break;
    }
  }

  return {
    matchedGroupIds: [...matched.keys()],
    targetWorldX: target.worldX,
    targetWorldY: target.worldY,
  };
}
