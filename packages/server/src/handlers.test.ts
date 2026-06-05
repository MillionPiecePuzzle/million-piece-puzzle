import { describe, it, expect, vi } from "vitest";
import { dispatch, handleGrab, handleDrop, handleDevPlace } from "./handlers.js";
import type { Context } from "./handlers.js";
import type { Client } from "./hub.js";
import type { PuzzleMeta } from "./state.js";
import type { GroupRuntime } from "@mpp/shared";
import { GroupQueue } from "./queue.js";

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

const client = {
  userId: "u1",
  bucket: { consume: () => true },
  held: new Set<number>(),
} as unknown as Client;

const badMessage = () => expect.objectContaining({ t: "error", code: "bad_message" });

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return;
    await flush();
  }
  throw new Error("waitFor timed out");
}

function makeCtx() {
  const send = vi.fn();
  const broadcast = vi.fn();
  const broadcastNear = vi.fn();
  const tryAcquireGroup = vi.fn();
  const readGroup = vi.fn();
  const ctx = {
    hub: { send, broadcast, broadcastNear },
    state: { tryAcquireGroup, readGroup },
    meta,
    puzzleId: "test",
    mongo: { logMerge: vi.fn() },
    eventLog: { recordDrop: vi.fn(), recordSnap: vi.fn() },
    queue: new GroupQueue(),
  } as unknown as Context;
  return { ctx, send, broadcast, broadcastNear, tryAcquireGroup, readGroup };
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

  it("rejects a viewport with non-finite coordinates", async () => {
    const { ctx, send } = makeCtx();
    await dispatch(
      ctx,
      client,
      '{"t":"viewport","worldX":1e999,"worldY":0,"worldW":100,"worldH":100}',
    );
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("rejects a viewport with negative dimensions", async () => {
    const { ctx, send } = makeCtx();
    await dispatch(
      ctx,
      client,
      JSON.stringify({ t: "viewport", worldX: 0, worldY: 0, worldW: -1, worldH: 100 }),
    );
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("stores a valid viewport on the client", async () => {
    const { ctx } = makeCtx();
    const c = {
      userId: "u1",
      bucket: { consume: () => true },
      viewport: null,
    } as unknown as Client;
    await dispatch(
      ctx,
      c,
      JSON.stringify({ t: "viewport", worldX: 10, worldY: 20, worldW: 100, worldH: 200 }),
    );
    expect(c.viewport).toEqual({ worldX: 10, worldY: 20, worldW: 100, worldH: 200 });
  });

  it("rejects a cursor with non-finite coordinates", async () => {
    const { ctx, send, broadcastNear } = makeCtx();
    await dispatch(ctx, client, '{"t":"cursor","worldX":1e999,"worldY":0}');
    expect(broadcastNear).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(client, badMessage());
  });

  it("relays a valid cursor to viewport-neighbor peers, excepting the sender", async () => {
    const { ctx, broadcastNear } = makeCtx();
    await dispatch(ctx, client, JSON.stringify({ t: "cursor", worldX: 30, worldY: 40 }));
    expect(broadcastNear).toHaveBeenCalledWith(
      expect.objectContaining({ t: "cursor", userId: "u1", worldX: 30, worldY: 40 }),
      30,
      40,
      client,
    );
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

  it("tracks the held group id on a winning grab", async () => {
    const { ctx, tryAcquireGroup } = makeCtx();
    tryAcquireGroup.mockResolvedValue(null);
    const c = { userId: "u1", held: new Set<number>() } as unknown as Client;
    await handleGrab(ctx, c, { t: "grab", groupId: 7 });
    expect([...c.held]).toEqual([7]);
  });

  it("does not track the group when the grab is denied", async () => {
    const { ctx, tryAcquireGroup } = makeCtx();
    tryAcquireGroup.mockResolvedValue("other-user");
    const c = { userId: "u1", held: new Set<number>() } as unknown as Client;
    await handleGrab(ctx, c, { t: "grab", groupId: 7 });
    expect(c.held.size).toBe(0);
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

  readAllGroups(): Promise<GroupRuntime[]> {
    return Promise.resolve([...this.groups.values()].map((g) => ({ ...g })));
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
  const broadcastNear = vi.fn();
  const logMerge = vi.fn();
  const leaderboard = vi.fn().mockResolvedValue([]);
  const state = new FakeState();
  const ctx = {
    hub: { send, broadcast, broadcastNear },
    state,
    meta: dropMeta,
    puzzleId: "test",
    mongo: { logMerge, leaderboard },
    eventLog: { recordDrop: vi.fn(), recordSnap: vi.fn() },
    queue: new GroupQueue(),
  } as unknown as Context;
  return { ctx, send, broadcast, broadcastNear, logMerge, leaderboard, state };
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
    const { ctx, broadcastNear, state } = makeDropCtx();
    state.place(dropped(4, 500, 500), [4]);
    await handleDrop(ctx, client, { t: "drop", groupId: 4, worldX: 500, worldY: 500 });
    expect(state.groups.get(4)?.heldBy).toBeNull();
    expect(broadcastNear).toHaveBeenCalledWith(
      expect.objectContaining({ t: "drop", groupId: 4 }),
      500,
      500,
    );
  });

  it("removes the group from the held set once the drop completes", async () => {
    const { ctx, state } = makeDropCtx();
    state.place(dropped(4, 500, 500), [4]);
    const c = { userId: "u1", held: new Set<number>([4]) } as unknown as Client;
    await handleDrop(ctx, c, { t: "drop", groupId: 4, worldX: 500, worldY: 500 });
    expect(c.held.has(4)).toBe(false);
  });

  it("keeps the held group when the drop reports an expand pass", async () => {
    const { ctx, state } = makeDropCtx();
    // The snap reaches group 1, which the passed lock set does not cover, so
    // handleDrop returns { expand } and mutates nothing, including the held set.
    state.place({ id: 1, worldX: 200, worldY: 200, size: 1, locked: false, heldBy: null }, [1]);
    state.place(dropped(4, 200, 200), [4]);
    const c = { userId: "u1", held: new Set<number>([4]) } as unknown as Client;
    const outcome = await handleDrop(
      ctx,
      c,
      { t: "drop", groupId: 4, worldX: 200, worldY: 200 },
      new Set([4]),
    );
    expect(outcome).toEqual({ expand: [4, 1] });
    expect(c.held.has(4)).toBe(true);
  });

  it("anchors the group to the frame when dropped near the origin", async () => {
    const { ctx, broadcast, logMerge, state } = makeDropCtx();
    state.place(dropped(4, 3, -4), [4]);
    await handleDrop(ctx, client, { t: "drop", groupId: 4, worldX: 3, worldY: -4 });
    expect(state.groups.get(4)?.locked).toBe(true);
    expect(state.lockedCount).toBe(1);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ t: "snap", anchored: true, lockedCount: 1 }),
    );
    expect(logMerge).toHaveBeenCalledWith(
      expect.objectContaining({ anchored: true, lockedDelta: 1 }),
    );
    // An anchoring snap rebroadcasts the live leaderboard, before completion.
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ t: "leaderboard" }));
  });

  it("merges the dropped group into an aligned unlocked neighbour", async () => {
    const { ctx, broadcast, logMerge, state } = makeDropCtx();
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
    expect(logMerge).toHaveBeenCalledWith(
      expect.objectContaining({ anchored: false, lockedDelta: 0, droppedPieceIds: [4] }),
    );
  });

  it("anchors the merged cluster and counts pieces when snapping onto a locked neighbour", async () => {
    const { ctx, broadcast, logMerge, state } = makeDropCtx();
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
    expect(logMerge).toHaveBeenCalledWith(
      expect.objectContaining({ anchored: true, lockedDelta: 1 }),
    );
  });

  it("broadcasts a leaderboard and marks the puzzle completed when the final piece is anchored", async () => {
    const send = vi.fn();
    const broadcast = vi.fn();
    const broadcastNear = vi.fn();
    const logMerge = vi.fn();
    const leaderboard = vi.fn().mockResolvedValue([{ userId: "u1", pieces: 1 }]);
    const markCompleted = vi.fn().mockResolvedValue(undefined);
    const state = new FakeState();
    const onePieceMeta: PuzzleMeta = { ...dropMeta, totalPieces: 1, gridRows: 1, gridCols: 1 };
    const ctx = {
      hub: { send, broadcast, broadcastNear },
      state,
      meta: onePieceMeta,
      puzzleId: "test",
      mongo: { logMerge, leaderboard },
      eventLog: { recordDrop: vi.fn(), recordSnap: vi.fn() },
      lifecycle: { markCompleted },
    } as unknown as Context;
    state.place(dropped(0, 2, 2), [0]);

    await handleDrop(ctx, client, { t: "drop", groupId: 0, worldX: 2, worldY: 2 });

    expect(state.lockedCount).toBe(1);
    expect(leaderboard).toHaveBeenCalledWith("test", expect.any(Number));
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ t: "leaderboard", entries: [{ userId: "u1", pieces: 1 }] }),
    );
    expect(markCompleted).toHaveBeenCalled();
  });
});

describe("handleDevPlace", () => {
  it("rejects when dev controls are disabled", async () => {
    const { ctx, send } = makeDropCtx();
    (ctx as { devEnabled?: boolean }).devEnabled = false;
    await handleDevPlace(ctx, client);
    expect(send).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ t: "error", code: "dev_disabled" }),
    );
  });

  it("anchors a random unlocked cluster to the frame origin", async () => {
    const { ctx, broadcast, logMerge, state } = makeDropCtx();
    (ctx as { devEnabled?: boolean }).devEnabled = true;
    state.place({ id: 4, worldX: 500, worldY: 500, size: 1, locked: false, heldBy: null }, [4]);
    await handleDevPlace(ctx, client);
    expect(state.groups.get(4)?.locked).toBe(true);
    expect(state.groups.get(4)?.worldX).toBe(0);
    expect(state.groups.get(4)?.worldY).toBe(0);
    expect(state.lockedCount).toBe(1);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ t: "snap", anchored: true, lockedCount: 1 }),
    );
    expect(logMerge).toHaveBeenCalledWith(
      expect.objectContaining({ anchored: true, lockedDelta: 1 }),
    );
  });

  it("does nothing when no unlocked, unheld cluster is available", async () => {
    const { ctx, broadcast, state } = makeDropCtx();
    (ctx as { devEnabled?: boolean }).devEnabled = true;
    state.place({ id: 0, worldX: 0, worldY: 0, size: 1, locked: true, heldBy: null }, [0]);
    state.place({ id: 1, worldX: 300, worldY: 300, size: 1, locked: false, heldBy: "other" }, [1]);
    await handleDevPlace(ctx, client);
    expect(broadcast).not.toHaveBeenCalled();
  });
});

// A drop that snaps onto a neighbour mutates two groups at once. Routed through
// the per-group queue, the dispatcher discovers the neighbour and re-runs the
// drop holding both groups' locks. These tests drive that path end to end.
describe("cross-group merge ordering", () => {
  it("merges the dropped group into its neighbour through the per-group queue", async () => {
    const { ctx, state, broadcast } = makeDropCtx();
    state.place({ id: 1, worldX: 200, worldY: 200, size: 1, locked: false, heldBy: null }, [1]);
    state.place(dropped(4, 200, 200), [4]);

    await dispatch(
      ctx,
      client,
      JSON.stringify({ t: "drop", groupId: 4, worldX: 200, worldY: 200 }),
    );

    expect(state.groups.has(4)).toBe(false);
    expect(state.groups.get(1)?.size).toBe(2);
    expect(state.pieceToGroup.get(4)).toBe(1);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ t: "snap", newGroupId: 1, anchored: false }),
    );
  });

  it("holds both groups' locks for the whole merge, so a later op on the neighbour waits", async () => {
    const { ctx, state } = makeDropCtx();
    state.place({ id: 1, worldX: 200, worldY: 200, size: 1, locked: false, heldBy: null }, [1]);
    state.place(dropped(4, 200, 200), [4]);

    // Hold the merge mid read-modify-write, after group 4 is folded into group 1
    // but before the merged group is written back.
    const events: string[] = [];
    const gate = deferred();
    const realAdd = state.addGroupPieces.bind(state);
    state.addGroupPieces = (id: number, pieces: number[]): Promise<void> => {
      events.push("merge-write");
      return gate.promise.then(() => realAdd(id, pieces));
    };

    const dropDone = dispatch(
      ctx,
      client,
      JSON.stringify({ t: "drop", groupId: 4, worldX: 200, worldY: 200 }),
    );
    await waitFor(() => events.includes("merge-write"));

    // A task on the neighbour group must queue behind the in-flight merge,
    // proving the dispatched drop holds group 1's lock, not just group 4's.
    let neighbourRan = false;
    const neighbour = ctx.queue.run("probe", [1], async () => {
      neighbourRan = true;
    });
    await flush();
    expect(neighbourRan).toBe(false);

    gate.resolve();
    await Promise.all([dropDone, neighbour]);
    expect(neighbourRan).toBe(true);
    expect(state.groups.get(1)?.size).toBe(2);
  });
});
