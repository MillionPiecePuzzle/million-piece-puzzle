import { describe, it, expect, vi } from "vitest";
import { dispatch, handleGrab, handleDrop } from "./handlers.js";
import type { Context } from "./handlers.js";
import type { Client } from "./hub.js";
import type { PuzzleMeta } from "./state.js";
import type { GroupRuntime } from "@mpp/shared";

const meta: PuzzleMeta = {
  totalPieces: 100,
  gridRows: 10,
  gridCols: 10,
  pieceSize: 100,
  snapTolerance: 10,
  generationSeed: "test",
  status: "active",
  startedAt: 0,
};

const client = { userId: "u1" } as unknown as Client;

const badMessage = () => expect.objectContaining({ t: "error", code: "bad_message" });

function makeCtx() {
  const send = vi.fn();
  const broadcast = vi.fn();
  const tryAcquireGroup = vi.fn();
  const readGroup = vi.fn();
  const ctx = {
    hub: { send, broadcast },
    state: { tryAcquireGroup, readGroup },
    meta,
    puzzleId: "test",
    mongo: { logMerge: vi.fn() },
  } as unknown as Context;
  return { ctx, send, broadcast, tryAcquireGroup, readGroup };
}

describe("dispatch validation", () => {
  it("rejects an out-of-range groupId on grab before touching Redis", async () => {
    const { ctx, send, tryAcquireGroup } = makeCtx();
    await dispatch(ctx, client, JSON.stringify({ t: "grab", groupId: 100 }));
    expect(tryAcquireGroup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("rejects a negative groupId on grab", async () => {
    const { ctx, send, tryAcquireGroup } = makeCtx();
    await dispatch(ctx, client, JSON.stringify({ t: "grab", groupId: -1 }));
    expect(tryAcquireGroup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("rejects a non-integer groupId on grab", async () => {
    const { ctx, send, tryAcquireGroup } = makeCtx();
    await dispatch(ctx, client, JSON.stringify({ t: "grab", groupId: 1.5 }));
    expect(tryAcquireGroup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("rejects a non-numeric groupId on grab", async () => {
    const { ctx, send, tryAcquireGroup } = makeCtx();
    await dispatch(ctx, client, JSON.stringify({ t: "grab", groupId: "5" }));
    expect(tryAcquireGroup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("accepts a valid groupId on grab", async () => {
    const { ctx, tryAcquireGroup } = makeCtx();
    tryAcquireGroup.mockResolvedValue(null);
    await dispatch(ctx, client, JSON.stringify({ t: "grab", groupId: 5 }));
    expect(tryAcquireGroup).toHaveBeenCalledWith(5, "u1");
  });

  it("rejects non-finite coordinates on drag before touching Redis", async () => {
    const { ctx, send, readGroup } = makeCtx();
    await dispatch(ctx, client, '{"t":"drag","groupId":5,"worldX":1e999,"worldY":0}');
    expect(readGroup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("rejects non-numeric coordinates on drag", async () => {
    const { ctx, send, readGroup } = makeCtx();
    await dispatch(ctx, client, JSON.stringify({ t: "drag", groupId: 5, worldX: "10", worldY: 0 }));
    expect(readGroup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("rejects an out-of-range groupId on drop before touching Redis", async () => {
    const { ctx, send, readGroup } = makeCtx();
    await dispatch(ctx, client, JSON.stringify({ t: "drop", groupId: 100, worldX: 0, worldY: 0 }));
    expect(readGroup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("rejects non-finite coordinates on drop", async () => {
    const { ctx, send, readGroup } = makeCtx();
    await dispatch(ctx, client, '{"t":"drop","groupId":5,"worldX":0,"worldY":-1e999}');
    expect(readGroup).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("accepts valid input on drag", async () => {
    const { ctx, readGroup } = makeCtx();
    readGroup.mockResolvedValue({
      id: 5,
      worldX: 0,
      worldY: 0,
      locked: false,
      size: 1,
      heldBy: "u1",
    });
    await dispatch(ctx, client, JSON.stringify({ t: "drag", groupId: 5, worldX: 10, worldY: 20 }));
    expect(readGroup).toHaveBeenCalledWith(5);
  });

  it("rejects invalid JSON", async () => {
    const { ctx, send } = makeCtx();
    await dispatch(ctx, client, "not json");
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });
});

describe("handleGrab", () => {
  it("sends unknown_group when the group does not exist", async () => {
    const { ctx, send, tryAcquireGroup } = makeCtx();
    tryAcquireGroup.mockResolvedValue("MISSING");
    await handleGrab(ctx, client, { t: "grab", groupId: 5 });
    expect(send).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ t: "error", code: "unknown_group" }),
    );
  });

  it("broadcasts grab_ok when acquisition succeeds", async () => {
    const { ctx, broadcast, tryAcquireGroup } = makeCtx();
    tryAcquireGroup.mockResolvedValue(null);
    await handleGrab(ctx, client, { t: "grab", groupId: 5 });
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ t: "grab_ok", groupId: 5, userId: "u1" }),
    );
  });

  it("denies the grab with the current holder when already held", async () => {
    const { ctx, send, tryAcquireGroup } = makeCtx();
    tryAcquireGroup.mockResolvedValue("other-user");
    await handleGrab(ctx, client, { t: "grab", groupId: 5 });
    expect(send).toHaveBeenCalledWith(client, {
      t: "grab_denied",
      groupId: 5,
      heldBy: "other-user",
    });
  });

  it("denies the grab with an empty holder when the group is locked", async () => {
    const { ctx, send, tryAcquireGroup } = makeCtx();
    tryAcquireGroup.mockResolvedValue("LOCKED");
    await handleGrab(ctx, client, { t: "grab", groupId: 5 });
    expect(send).toHaveBeenCalledWith(client, { t: "grab_denied", groupId: 5, heldBy: "" });
  });
});

// In-memory RedisState stand-in: a real working store so handleDrop exercises
// detectSnap and applyMerge end to end, not just stubbed return values.
class FakeState {
  readonly groups = new Map<number, GroupRuntime>();
  readonly pieceToGroup = new Map<number, number>();
  readonly groupPieces = new Map<number, Set<number>>();
  lockedCount = 0;

  place(group: GroupRuntime, pieceIds: number[]): void {
    this.groups.set(group.id, { ...group });
    this.groupPieces.set(group.id, new Set(pieceIds));
    for (const p of pieceIds) this.pieceToGroup.set(p, group.id);
    if (group.locked) this.lockedCount += group.size;
  }

  readGroup(id: number): Promise<GroupRuntime | null> {
    const g = this.groups.get(id);
    return Promise.resolve(g ? { ...g } : null);
  }

  writeGroup(g: GroupRuntime): Promise<void> {
    this.groups.set(g.id, { ...g });
    return Promise.resolve();
  }

  setGroupPosition(id: number, worldX: number, worldY: number): Promise<void> {
    const g = this.groups.get(id);
    if (g) {
      g.worldX = worldX;
      g.worldY = worldY;
    }
    return Promise.resolve();
  }

  releaseGroup(id: number): Promise<void> {
    const g = this.groups.get(id);
    if (g) g.heldBy = null;
    return Promise.resolve();
  }

  deleteGroup(id: number): Promise<void> {
    this.groups.delete(id);
    this.groupPieces.delete(id);
    return Promise.resolve();
  }

  getGroupPieces(id: number): Promise<number[]> {
    const set = this.groupPieces.get(id);
    return Promise.resolve(set ? [...set] : []);
  }

  addGroupPieces(id: number, pieceIds: number[]): Promise<void> {
    const set = this.groupPieces.get(id) ?? new Set<number>();
    for (const p of pieceIds) set.add(p);
    this.groupPieces.set(id, set);
    return Promise.resolve();
  }

  setPieceGroup(pieceId: number, groupId: number): Promise<void> {
    this.pieceToGroup.set(pieceId, groupId);
    return Promise.resolve();
  }

  readPieceGroup(id: number): Promise<number | null> {
    return Promise.resolve(this.pieceToGroup.get(id) ?? null);
  }

  getLockedCount(): Promise<number> {
    return Promise.resolve(this.lockedCount);
  }

  addLockedCount(delta: number): Promise<number> {
    this.lockedCount += delta;
    return Promise.resolve(this.lockedCount);
  }
}

// 3x3 grid: piece 4 is the center, its grid-neighbours are 1, 3, 5, 7.
const dropMeta: PuzzleMeta = {
  totalPieces: 9,
  gridRows: 3,
  gridCols: 3,
  pieceSize: 100,
  snapTolerance: 10,
  generationSeed: "test",
  status: "active",
  startedAt: 0,
};

function makeDropCtx() {
  const send = vi.fn();
  const broadcast = vi.fn();
  const logMerge = vi.fn();
  const state = new FakeState();
  const ctx = {
    hub: { send, broadcast },
    state,
    meta: dropMeta,
    puzzleId: "test",
    mongo: { logMerge },
  } as unknown as Context;
  return { ctx, send, broadcast, logMerge, state };
}

const dropped = (id: number, worldX: number, worldY: number): GroupRuntime => ({
  id,
  worldX,
  worldY,
  size: 1,
  locked: false,
  heldBy: "u1",
});

describe("handleDrop", () => {
  it("rejects a drop on a group that does not exist", async () => {
    const { ctx, send } = makeDropCtx();
    await handleDrop(ctx, client, { t: "drop", groupId: 4, worldX: 0, worldY: 0 });
    expect(send).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ t: "error", code: "unknown_group" }),
    );
  });

  it("rejects a drop on a group held by someone else", async () => {
    const { ctx, send, state } = makeDropCtx();
    state.place({ id: 4, worldX: 0, worldY: 0, size: 1, locked: false, heldBy: "other" }, [4]);
    await handleDrop(ctx, client, { t: "drop", groupId: 4, worldX: 0, worldY: 0 });
    expect(send).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ t: "error", code: "not_held" }),
    );
  });

  it("releases the group and broadcasts a drop when nothing snaps", async () => {
    const { ctx, broadcast, state } = makeDropCtx();
    state.place(dropped(4, 500, 500), [4]);
    await handleDrop(ctx, client, { t: "drop", groupId: 4, worldX: 500, worldY: 500 });
    expect(state.groups.get(4)?.heldBy).toBeNull();
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ t: "drop", groupId: 4 }));
  });

  it("anchors the group to the frame when dropped near the origin", async () => {
    const { ctx, broadcast, state } = makeDropCtx();
    state.place(dropped(4, 3, -4), [4]);
    await handleDrop(ctx, client, { t: "drop", groupId: 4, worldX: 3, worldY: -4 });
    expect(state.groups.get(4)?.locked).toBe(true);
    expect(state.lockedCount).toBe(1);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ t: "snap", anchored: true, lockedCount: 1 }),
    );
  });

  it("merges the dropped group into an aligned unlocked neighbour", async () => {
    const { ctx, broadcast, state } = makeDropCtx();
    state.place({ id: 1, worldX: 200, worldY: 200, size: 1, locked: false, heldBy: null }, [1]);
    state.place(dropped(4, 200, 200), [4]);
    await handleDrop(ctx, client, { t: "drop", groupId: 4, worldX: 200, worldY: 200 });
    expect(state.groups.has(4)).toBe(false);
    expect(state.groups.get(1)?.size).toBe(2);
    expect(state.groups.get(1)?.locked).toBe(false);
    expect(state.pieceToGroup.get(4)).toBe(1);
    expect(state.pieceToGroup.get(1)).toBe(1);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ t: "snap", newGroupId: 1, anchored: false }),
    );
  });

  it("anchors the merged cluster and counts pieces when snapping onto a locked neighbour", async () => {
    const { ctx, broadcast, state } = makeDropCtx();
    state.place({ id: 1, worldX: 100, worldY: 100, size: 1, locked: true, heldBy: null }, [1]);
    state.place(dropped(4, 100, 100), [4]);
    expect(state.lockedCount).toBe(1);
    await handleDrop(ctx, client, { t: "drop", groupId: 4, worldX: 100, worldY: 100 });
    expect(state.groups.get(1)?.locked).toBe(true);
    expect(state.groups.get(1)?.size).toBe(2);
    expect(state.lockedCount).toBe(2);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ t: "snap", newGroupId: 1, anchored: true, lockedCount: 2 }),
    );
  });
});
