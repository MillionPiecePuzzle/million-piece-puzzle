import { describe, it, expect, vi } from "vitest";
import { releaseHeldGroups, sweepStaleHolds } from "./holds.js";
import type { Context } from "./handlers.js";
import type { Client, Hub } from "./hub.js";
import type { StoredGroup } from "./state.js";
import { GroupQueue } from "./queue.js";
import type { WireContext } from "./wire.js";

// A no-op wire boundary: identity permutation and pieceSize 0, so wire ids
// equal grid ids and anchor positions equal origins (matches handlers.test.ts).
function transparentWire(n: number, gridCols: number): WireContext {
  const idmap = new Int32Array(n);
  for (let i = 0; i < n; i++) idmap[i] = i;
  return { gridCols, pieceSize: 0, wireForGrid: idmap, gridForWire: idmap };
}

function makeCtx() {
  const readGroup = vi.fn<(id: number) => Promise<StoredGroup | null>>();
  const releaseGroup = vi.fn<(id: number) => Promise<void>>().mockResolvedValue(undefined);
  const staleHeldGroups = vi.fn<(cutoffMs: number) => Promise<number[]>>();
  const forgetHeldGroup = vi.fn<(id: number) => Promise<void>>().mockResolvedValue(undefined);
  const ctx = {
    state: { readGroup, releaseGroup, staleHeldGroups, forgetHeldGroup },
    wire: transparentWire(100, 10),
    queue: new GroupQueue(),
  } as unknown as Context;
  return { ctx, readGroup, releaseGroup, staleHeldGroups, forgetHeldGroup };
}

function group(over: Partial<StoredGroup> = {}): StoredGroup {
  return {
    id: 4,
    worldX: 100,
    worldY: 200,
    locked: false,
    size: 1,
    heldBy: "u1",
    localAabb: null,
    ...over,
  };
}

function makeHub() {
  return { broadcastOverlapping: vi.fn() } as unknown as Hub;
}

describe("releaseHeldGroups", () => {
  it("does nothing when the client held nothing", async () => {
    const { ctx, readGroup } = makeCtx();
    const hub = makeHub();
    const client = { userId: "u1", held: new Set<number>() } as unknown as Client;
    await releaseHeldGroups(ctx, client, hub);
    expect(readGroup).not.toHaveBeenCalled();
    expect(hub.broadcastOverlapping).not.toHaveBeenCalled();
  });

  it("releases every group still legitimately held and broadcasts its drop", async () => {
    const { ctx, readGroup, releaseGroup } = makeCtx();
    readGroup.mockImplementation((id: number) =>
      Promise.resolve(group({ id, worldX: id * 10, worldY: id * 20, heldBy: "u1" })),
    );
    const hub = makeHub();
    const client = { userId: "u1", held: new Set<number>([4, 5]) } as unknown as Client;
    await releaseHeldGroups(ctx, client, hub);
    expect(releaseGroup).toHaveBeenCalledWith(4);
    expect(releaseGroup).toHaveBeenCalledWith(5);
    expect(hub.broadcastOverlapping).toHaveBeenCalledWith(
      expect.objectContaining({ t: "drop", groupId: 4, worldX: 40, worldY: 80, userId: "u1" }),
      expect.anything(),
    );
    expect(hub.broadcastOverlapping).toHaveBeenCalledWith(
      expect.objectContaining({ t: "drop", groupId: 5, worldX: 50, worldY: 100, userId: "u1" }),
      expect.anything(),
    );
  });

  it("skips a held id that already merged away", async () => {
    const { ctx, readGroup, releaseGroup } = makeCtx();
    readGroup.mockResolvedValue(null);
    const hub = makeHub();
    const client = { userId: "u1", held: new Set<number>([4]) } as unknown as Client;
    await releaseHeldGroups(ctx, client, hub);
    expect(releaseGroup).not.toHaveBeenCalled();
    expect(hub.broadcastOverlapping).not.toHaveBeenCalled();
  });

  it("skips a held id now owned by someone else", async () => {
    const { ctx, readGroup, releaseGroup } = makeCtx();
    readGroup.mockResolvedValue(group({ heldBy: "other-user" }));
    const hub = makeHub();
    const client = { userId: "u1", held: new Set<number>([4]) } as unknown as Client;
    await releaseHeldGroups(ctx, client, hub);
    expect(releaseGroup).not.toHaveBeenCalled();
    expect(hub.broadcastOverlapping).not.toHaveBeenCalled();
  });
});

describe("sweepStaleHolds", () => {
  it("does nothing when there are no stale holds", async () => {
    const { ctx, staleHeldGroups, readGroup } = makeCtx();
    staleHeldGroups.mockResolvedValue([]);
    const hub = makeHub();
    await sweepStaleHolds(ctx, hub, 180000);
    expect(readGroup).not.toHaveBeenCalled();
  });

  it("force-releases a group whose hold is still standing past the threshold", async () => {
    const { ctx, staleHeldGroups, readGroup, releaseGroup } = makeCtx();
    staleHeldGroups.mockResolvedValue([9]);
    readGroup.mockResolvedValue(group({ id: 9, worldX: 5, worldY: 6, heldBy: "ghost-user" }));
    const hub = makeHub();
    await sweepStaleHolds(ctx, hub, 180000);
    expect(releaseGroup).toHaveBeenCalledWith(9);
    expect(hub.broadcastOverlapping).toHaveBeenCalledWith(
      expect.objectContaining({
        t: "drop",
        groupId: 9,
        worldX: 5,
        worldY: 6,
        userId: "ghost-user",
      }),
      expect.anything(),
    );
  });

  it("forgets a stale entry whose group no longer exists", async () => {
    const { ctx, staleHeldGroups, readGroup, releaseGroup, forgetHeldGroup } = makeCtx();
    staleHeldGroups.mockResolvedValue([9]);
    readGroup.mockResolvedValue(null);
    const hub = makeHub();
    await sweepStaleHolds(ctx, hub, 180000);
    expect(forgetHeldGroup).toHaveBeenCalledWith(9);
    expect(releaseGroup).not.toHaveBeenCalled();
    expect(hub.broadcastOverlapping).not.toHaveBeenCalled();
  });

  it("forgets a stale entry whose group is no longer held", async () => {
    const { ctx, staleHeldGroups, readGroup, releaseGroup, forgetHeldGroup } = makeCtx();
    staleHeldGroups.mockResolvedValue([9]);
    readGroup.mockResolvedValue(group({ id: 9, heldBy: null }));
    const hub = makeHub();
    await sweepStaleHolds(ctx, hub, 180000);
    expect(forgetHeldGroup).toHaveBeenCalledWith(9);
    expect(releaseGroup).not.toHaveBeenCalled();
  });

  it("passes now-minus-threshold as the staleness cutoff", async () => {
    const { ctx, staleHeldGroups } = makeCtx();
    staleHeldGroups.mockResolvedValue([]);
    const hub = makeHub();
    const before = Date.now();
    await sweepStaleHolds(ctx, hub, 180000);
    const [cutoff] = staleHeldGroups.mock.calls[0] as [number];
    expect(cutoff).toBeLessThanOrEqual(before - 180000 + 5);
    expect(cutoff).toBeGreaterThan(before - 180000 - 1000);
  });
});
