import { describe, it, expect } from "vitest";
import {
  runInvariants,
  replayMerges,
  type StateSnapshot,
  type MergeRecord,
  type GroupState,
} from "./stateInvariants.js";

// A small hand-built board: 4 singletons, then pieces 0+1 merge (host 0), then
// that cluster anchors to the frame. Final partition: {0,1} locked, {2}, {3}.
function healthyBoard(): { snap: StateSnapshot; merges: MergeRecord[] } {
  const groups: GroupState[] = [
    { id: 0, size: 2, locked: true, heldBy: null },
    { id: 2, size: 1, locked: false, heldBy: null },
    { id: 3, size: 1, locked: false, heldBy: null },
  ];
  const groupPieces = new Map<number, Set<number>>([
    [0, new Set([0, 1])],
    [2, new Set([2])],
    [3, new Set([3])],
  ]);
  const pieceGroup = new Map<number, number>([
    [0, 0],
    [1, 0],
    [2, 2],
    [3, 3],
  ]);
  const snap: StateSnapshot = {
    totalPieces: 4,
    groups,
    pieceGroup,
    groupPieces,
    lockedCount: 2,
  };
  const merges: MergeRecord[] = [
    { addedPieceIds: [1], targetAnchorPieceId: 0, anchored: false, lockedDelta: 0, at: 100 },
    { addedPieceIds: [], targetAnchorPieceId: 0, anchored: true, lockedDelta: 2, at: 200 },
  ];
  return { snap, merges };
}

function ok(checks: { ok: boolean }[]): boolean {
  return checks.every((c) => c.ok);
}

describe("runInvariants", () => {
  it("passes a healthy board", () => {
    const { snap, merges } = healthyBoard();
    const checks = runInvariants(snap, merges);
    expect(ok(checks)).toBe(true);
  });

  it("flags a piece missing from every group set", () => {
    const { snap, merges } = healthyBoard();
    snap.groupPieces.get(3)!.delete(3);
    snap.groups.find((g) => g.id === 3)!.size = 0;
    const checks = runInvariants(snap, merges);
    expect(checks.find((c) => c.name.startsWith("partition"))!.ok).toBe(false);
  });

  it("flags a piece duplicated across two groups", () => {
    const { snap, merges } = healthyBoard();
    snap.groupPieces.get(2)!.add(3);
    const checks = runInvariants(snap, merges);
    expect(checks.find((c) => c.name.startsWith("partition"))!.ok).toBe(false);
  });

  it("flags a piece hash disagreeing with set membership", () => {
    const { snap, merges } = healthyBoard();
    snap.pieceGroup.set(2, 3);
    const checks = runInvariants(snap, merges);
    expect(checks.find((c) => c.name.startsWith("reverse index"))!.ok).toBe(false);
  });

  it("flags a group size that disagrees with its set", () => {
    const { snap, merges } = healthyBoard();
    snap.groups.find((g) => g.id === 0)!.size = 3;
    const checks = runInvariants(snap, merges);
    expect(checks.find((c) => c.name === "group size equals set cardinality")!.ok).toBe(false);
  });

  it("flags a locked-count that does not match locked groups", () => {
    const { snap, merges } = healthyBoard();
    snap.lockedCount = 1;
    const checks = runInvariants(snap, merges);
    expect(checks.find((c) => c.name.startsWith("locked-count"))!.ok).toBe(false);
  });

  it("flags a group still held at rest", () => {
    const { snap, merges } = healthyBoard();
    snap.groups.find((g) => g.id === 2)!.heldBy = "user-x";
    const checks = runInvariants(snap, merges);
    expect(checks.find((c) => c.name === "no group held at rest")!.ok).toBe(false);
  });

  it("flags a Redis partition the merge log cannot explain", () => {
    const { snap, merges } = healthyBoard();
    // Redis says 2 and 3 share a group, but no merge ever joined them.
    snap.groups = [
      { id: 0, size: 2, locked: true, heldBy: null },
      { id: 2, size: 2, locked: false, heldBy: null },
    ];
    snap.groupPieces = new Map<number, Set<number>>([
      [0, new Set([0, 1])],
      [2, new Set([2, 3])],
    ]);
    snap.pieceGroup.set(3, 2);
    const checks = runInvariants(snap, merges);
    expect(checks.find((c) => c.name.includes("replay partition matches Redis"))!.ok).toBe(false);
  });

  it("flags a locked group the merge log never anchored", () => {
    const { snap, merges } = healthyBoard();
    snap.groups.find((g) => g.id === 2)!.locked = true;
    snap.lockedCount = 3;
    const checks = runInvariants(snap, merges);
    expect(checks.find((c) => c.name.includes("locked state agrees"))!.ok).toBe(false);
  });
});

describe("replayMerges", () => {
  it("folds added pieces into the host component in at order", () => {
    const merges: MergeRecord[] = [
      { addedPieceIds: [1], targetAnchorPieceId: 0, anchored: false, lockedDelta: 0, at: 10 },
      { addedPieceIds: [2], targetAnchorPieceId: 1, anchored: false, lockedDelta: 0, at: 20 },
    ];
    const replay = replayMerges(5, merges);
    expect(replay.root[0]).toBe(replay.root[1]);
    expect(replay.root[1]).toBe(replay.root[2]);
    expect(replay.root[3]).not.toBe(replay.root[0]);
  });

  it("marks anchored components and sums lockedDelta", () => {
    const merges: MergeRecord[] = [
      { addedPieceIds: [1], targetAnchorPieceId: 0, anchored: true, lockedDelta: 2, at: 10 },
    ];
    const replay = replayMerges(3, merges);
    expect(replay.lockedRoots.has(replay.root[0]!)).toBe(true);
    expect(replay.lockedRoots.has(replay.root[2]!)).toBe(false);
    expect(replay.lockedDeltaSum).toBe(2);
  });
});
