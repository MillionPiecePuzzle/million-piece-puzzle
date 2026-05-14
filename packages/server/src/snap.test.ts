import { describe, it, expect } from "vitest";
import type { GroupRuntime } from "@mpp/shared";
import { detectSnap } from "./snap.js";
import type { RedisState } from "./state.js";

const group = (id: number, worldX: number, worldY: number, locked = false): GroupRuntime => ({
  id,
  worldX,
  worldY,
  locked,
  size: 1,
  heldBy: null,
});

class FakeState {
  readonly pieceGroups = new Map<number, number>();
  readonly groups = new Map<number, GroupRuntime>();

  place(pieceId: number, g: GroupRuntime): void {
    this.pieceGroups.set(pieceId, g.id);
    this.groups.set(g.id, g);
  }

  readPieceGroup(id: number): Promise<number | null> {
    return Promise.resolve(this.pieceGroups.has(id) ? this.pieceGroups.get(id)! : null);
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
    expect(match).toEqual({ matchedGroupIds: [100], targetWorldX: 5, targetWorldY: -3 });
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
    expect(match).toEqual({ matchedGroupIds: [100], targetWorldX: 8, targetWorldY: 0 });
  });

  it("prefers a locked candidate as the merge target", async () => {
    const state = new FakeState();
    state.place(1, group(100, 5, 0)); // unlocked, inserted first
    state.place(3, group(200, 0, 0, true)); // locked -> must be the target
    const dropped = group(50, 2, 0);
    const match = await detectSnap(asState(state), ROWS, COLS, 10, dropped, [4]);
    expect(match?.targetWorldX).toBe(0);
    expect(match?.targetWorldY).toBe(0);
    expect(match?.matchedGroupIds.sort((a, b) => a - b)).toEqual([100, 200]);
  });
});
