import { describe, it, expect } from "vitest";
import { WORLD_TILE_SIZE, type GroupRuntime } from "@mpp/shared";
import { GroupIndex } from "./groupIndex.js";
import { detectSnap, type SnapCover } from "./snap.js";
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

const PIECE = 100;

// Nothing indexed, so nothing ever covers a target piece: the cover gate is inert
// and these cases test the position matching alone.
const openBoard = (): SnapCover => ({
  index: new GroupIndex(WORLD_TILE_SIZE),
  pieceSize: PIECE,
  max: 5,
});

// 3x3 grid, piece 4 is the center; its neighbours are 1 (up), 7 (down), 3 (left), 5 (right).
const ROWS = 3;
const COLS = 3;

const snap = (state: FakeState, dropped: GroupRuntime, pieces: number[], cover = openBoard()) =>
  detectSnap(asState(state), ROWS, COLS, 10, dropped, pieces, cover);

describe("detectSnap", () => {
  it("returns no match when no neighbour has a group", async () => {
    const state = new FakeState();
    const dropped = group(50, 0, 0);
    expect(await snap(state, dropped, [4])).toEqual({ match: null, covered: false });
  });

  it("returns no match when a neighbour group is out of tolerance", async () => {
    const state = new FakeState();
    state.place(1, group(100, 100, 100));
    const dropped = group(50, 0, 0);
    expect((await snap(state, dropped, [4])).match).toBeNull();
  });

  it("matches a neighbour group aligned within tolerance", async () => {
    const state = new FakeState();
    state.place(1, group(100, 5, -3));
    const dropped = group(50, 0, 0);
    expect((await snap(state, dropped, [4])).match).toEqual({
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
    expect((await snap(state, dropped, [4, 5])).match).toBeNull();
  });

  it("ignores a neighbour piece that is already in the dropped group", async () => {
    const state = new FakeState();
    state.place(1, group(50, 0, 0));
    const dropped = group(50, 0, 0);
    expect((await snap(state, dropped, [4])).match).toBeNull();
  });

  it("keeps only candidates aligned with the chosen target", async () => {
    const state = new FakeState();
    // Both candidates are within tolerance of the dropped group at (0,0),
    // but 16 apart from each other, so they are not mutually aligned.
    state.place(1, group(100, 8, 0)); // up, inserted first -> becomes target
    state.place(3, group(200, -8, 0)); // left, 16 from the target
    const dropped = group(50, 0, 0);
    expect((await snap(state, dropped, [4])).match).toEqual({
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
    expect((await snap(state, dropped, [4])).match).toBeNull();
  });

  it("merges a free neighbour while skipping a held one", async () => {
    const state = new FakeState();
    state.place(1, { ...group(100, 5, 0), heldBy: "other-user" }); // up, held -> skipped
    state.place(3, group(200, 5, 0)); // left, free -> matched
    const dropped = group(50, 5, 0);
    expect((await snap(state, dropped, [4])).match).toEqual({
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
    const { match } = await snap(state, dropped, [4]);
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
    expect((await snap(state, dropped, [4])).match).toBeNull();
  });
});

// 10x10 grid, wide enough to park a pile of distinct pieces on one point. The
// dropped cluster holds piece 44 (col 4, row 4) and the target group holds its
// right neighbour 45, whose body sits at (500,400) and whose centre is (550,450).
const BIG_ROWS = 10;
const BIG_COLS = 10;

// One loose singleton parked so its body covers the target piece's centre, which
// is the pile this gate exists for: every piece of a stack sits on the same point
// with a different group origin.
function pileOn(state: FakeState, index: GroupIndex, groupId: number, pieceId: number): void {
  const originX = 500 - (pieceId % BIG_COLS) * PIECE;
  const originY = 400 - Math.floor(pieceId / BIG_COLS) * PIECE;
  state.place(pieceId, group(groupId, originX, originY));
  index.set(groupId, 500, 400, { originX, originY, size: 1, width: PIECE, height: PIECE });
}

function bigSnap(
  state: FakeState,
  index: GroupIndex,
  max: number,
  dropped: GroupRuntime,
  pieces: number[],
) {
  return detectSnap(asState(state), BIG_ROWS, BIG_COLS, 10, dropped, pieces, {
    index,
    pieceSize: PIECE,
    max,
  });
}

describe("detectSnap cover gate", () => {
  it("refuses a snap onto a piece more pieces than the cap are standing on", async () => {
    const state = new FakeState();
    const index = new GroupIndex(WORLD_TILE_SIZE);
    state.place(45, group(100, 0, 0));
    for (let i = 0; i < 3; i++) pileOn(state, index, 200 + i, i);
    const dropped = group(50, 0, 0);
    expect(await bigSnap(state, index, 2, dropped, [44])).toEqual({
      match: null,
      covered: true,
    });
  });

  it("allows the snap while the pile is within the cap", async () => {
    const state = new FakeState();
    const index = new GroupIndex(WORLD_TILE_SIZE);
    state.place(45, group(100, 0, 0));
    for (let i = 0; i < 3; i++) pileOn(state, index, 200 + i, i);
    const dropped = group(50, 0, 0);
    const { match, covered } = await bigSnap(state, index, 3, dropped, [44]);
    expect(covered).toBe(false);
    expect(match?.matchedGroupIds).toEqual([100]);
  });

  it("does not count a cluster whose box spans the point with no piece of its own there", async () => {
    const state = new FakeState();
    const index = new GroupIndex(WORLD_TILE_SIZE);
    state.place(45, group(100, 0, 0));
    // A ragged cluster holding pieces 0 and 22: its body spans 3x3 pieces from
    // (400,300), so the box covers the target centre while the piece that would
    // stand there (11) is one of the gaps in its own shape.
    const ragged = group(300, 400, 300);
    state.place(0, ragged);
    state.place(22, ragged);
    index.set(300, 400, 300, {
      originX: 400,
      originY: 300,
      size: 2,
      width: 3 * PIECE,
      height: 3 * PIECE,
    });
    const dropped = group(50, 0, 0);
    const { match, covered } = await bigSnap(state, index, 0, dropped, [44]);
    expect(covered).toBe(false);
    expect(match?.matchedGroupIds).toEqual([100]);
  });

  it("still snaps onto a cluster reached through a second contact piece in the open", async () => {
    const state = new FakeState();
    const index = new GroupIndex(WORLD_TILE_SIZE);
    // Two vertical dominoes side by side: pieces 44/54 dropped against 45/55.
    // Only the contact at piece 45 is buried, so the one at 55 carries the snap.
    const target = group(100, 0, 0);
    state.place(45, target);
    state.place(55, target);
    pileOn(state, index, 200, 0);
    const dropped = group(50, 0, 0);
    const { match, covered } = await bigSnap(state, index, 0, dropped, [44, 54]);
    expect(covered).toBe(false);
    expect(match?.matchedGroupIds).toEqual([100]);
  });

  it("anchors onto a locked neighbour whatever is piled on it", async () => {
    const state = new FakeState();
    const index = new GroupIndex(WORLD_TILE_SIZE);
    state.lock(45);
    for (let i = 0; i < 3; i++) pileOn(state, index, 200 + i, i);
    const dropped = group(50, 0, 0);
    const { match } = await bigSnap(state, index, 0, dropped, [44]);
    expect(match?.anchored).toBe(true);
  });
});
