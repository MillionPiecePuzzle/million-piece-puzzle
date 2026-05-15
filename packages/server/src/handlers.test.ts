import { describe, it, expect, vi } from "vitest";
import { dispatch, handleGrab } from "./handlers.js";
import type { Context } from "./handlers.js";
import type { Client } from "./hub.js";
import type { PuzzleMeta } from "./state.js";

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
