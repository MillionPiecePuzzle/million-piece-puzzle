import { describe, it, expect } from "vitest";
import type { GroupRuntime } from "@mpp/shared";
import { detectSnap } from "./snap.js";
import type { RedisState } from "./state.js";

const group = (id: number, worldX: number, worldY: number): GroupRuntime => ({
  id,
  worldX,
  worldY,
  size: 1,
  heldBy: null,
});

class FakeState {
  readonly pieceGroups = new Map<number, number>();
  readonly lockedPieces = new Set<number>();
  readonly groups = new Map<number, GroupRuntime>();

  place(pieceId: number, g: GroupRuntime): void {
    this.pieceGroups.set(pieceId, g.id);
    this.groups.set(g.id, g);
  }

  // A locked piece has no group (see DECISIONS: locked pieces stop being a group).
  lock(pieceId: number): void {
    this.lockedPieces.add(pieceId);
  }

  readPieceState(id: number): Promise<{ groupId: number | null; locked: boolean }> {
    if (this.lockedPieces.has(id)) return Promise.resolve({ groupId: null, locked: true });
    return Promise.resolve({
      groupId: this.pieceGroups.has(id) ? this.pieceGroups.get(id)! : null,
      locked: false,
    });
  }

  readGroup(id: number): Promise<GroupRuntime | null> {
    return Promise.resolve(this.groups.get(id) ?? null);
  }
}

const asState = (s: FakeState) => s as unknown as RedisState;

// 3x3 grid, piece 4 is the center; its neighbours are 1 (up), 7 (down), 3 (left), 5 (right).
const ROWS = 3;
const COLS = 3;

describe("detectSnap", () => {
  it("returns null when no neighbour has a group", async () => {
    const state = new FakeState();
    const dropped = group(50, 0, 0);
    expect(await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4])).toBeNull();
  });

  it("returns null when a neighbour group is out of tolerance", async () => {
    const state = new FakeState();
    state.place(1, group(100, 100, 100));
    const dropped = group(50, 0, 0);
    expect(await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4])).toBeNull();
  });

  it("matches a neighbour group aligned within tolerance", async () => {
    const state = new FakeState();
    state.place(1, group(100, 5, -3));
    const dropped = group(50, 0, 0);
    const match = await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4]);
    expect(match).toEqual({
      matchedGroupIds: [100],
      targetWorldX: 5,
      targetWorldY: -3,
      anchored: false,
      matchedSize: 1,
    });
  });

  it("ignores neighbour ids that belong to the dropped group's own pieces", async () => {
    const state = new FakeState();
    // piece 5 is a neighbour of 4 but is part of the dropped cluster.
    state.place(5, group(50, 0, 0));
    const dropped = group(50, 0, 0);
    expect(await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4, 5])).toBeNull();
  });

  it("ignores a neighbour piece that is already in the dropped group", async () => {
    const state = new FakeState();
    state.place(1, group(50, 0, 0));
    const dropped = group(50, 0, 0);
    expect(await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4])).toBeNull();
  });

  it("keeps only candidates aligned with the chosen target", async () => {
    const state = new FakeState();
    // Both candidates are within tolerance of the dropped group at (0,0),
    // but 16 apart from each other, so they are not mutually aligned.
    state.place(1, group(100, 8, 0)); // up, inserted first -> becomes target
    state.place(3, group(200, -8, 0)); // left, 16 from the target
    const dropped = group(50, 0, 0);
    const match = await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4]);
    expect(match).toEqual({
      matchedGroupIds: [100],
      targetWorldX: 8,
      targetWorldY: 0,
      anchored: false,
      matchedSize: 1,
    });
  });

  it("skips a neighbour cluster held by another user", async () => {
    const state = new FakeState();
    state.place(1, { ...group(100, 5, -3), heldBy: "other-user" });
    const dropped = group(50, 0, 0);
    expect(await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4])).toBeNull();
  });

  it("merges a free neighbour while skipping a held one", async () => {
    const state = new FakeState();
    state.place(1, { ...group(100, 5, 0), heldBy: "other-user" }); // up, held -> skipped
    state.place(3, group(200, 5, 0)); // left, free -> matched
    const dropped = group(50, 5, 0);
    const match = await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4]);
    expect(match).toEqual({
      matchedGroupIds: [200],
      targetWorldX: 5,
      targetWorldY: 0,
      anchored: false,
      matchedSize: 1,
    });
  });

  it("an already-locked neighbour sets the merge target and marks the drop anchored", async () => {
    const state = new FakeState();
    state.place(1, group(100, 5, 0)); // unlocked, inserted first
    state.lock(3); // locked piece, no group -> its implicit origin (0,0) still wins
    const dropped = group(50, 2, 0);
    const match = await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4]);
    expect(match?.targetWorldX).toBe(0);
    expect(match?.targetWorldY).toBe(0);
    expect(match?.anchored).toBe(true);
    expect(match?.matchedGroupIds).toEqual([100]);
  });

  it("does not anchor via a locked neighbour when the drop itself is far from the solved origin", async () => {
    const state = new FakeState();
    // Grid-adjacent to a locked piece, but this drop landed nowhere near its
    // own solved position: touching a locked neighbour cannot substitute for
    // the drop's own tolerance check (see detectSnap's dropAtOrigin gate).
    state.lock(3);
    const dropped = group(50, 500, 500);
    expect(await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4])).toBeNull();
  });
});
