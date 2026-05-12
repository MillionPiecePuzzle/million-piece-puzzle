import { randomUUID } from "node:crypto";
import type { CDrag, CDrop, CGrab, CHello, ClientMessage, ServerMessage } from "@mpp/shared";
import { PROTOCOL_VERSION } from "@mpp/shared";
import type { Hub, Client } from "./hub.js";
import type { RedisState, PuzzleMeta } from "./state.js";
import type { MongoLogger } from "./mongo.js";
import { detectSnap } from "./snap.js";

export type Context = {
  hub: Hub;
  state: RedisState;
  meta: PuzzleMeta;
  puzzleId: string;
  imageManifestUrl: string;
  mongo: MongoLogger;
};

function send(ctx: Context, client: Client, msg: ServerMessage): void {
  ctx.hub.send(client, msg);
}

function err(
  ctx: Context,
  client: Client,
  code: "bad_message" | "unknown_group" | "protocol_mismatch" | "not_held",
  message: string,
): void {
  send(ctx, client, { t: "error", code, message });
}

export async function handleHello(ctx: Context, client: Client, msg: CHello): Promise<void> {
  if (msg.protocolVersion !== PROTOCOL_VERSION) {
    err(
      ctx,
      client,
      "protocol_mismatch",
      `expected protocol v${PROTOCOL_VERSION}, got v${msg.protocolVersion}`,
    );
    client.ws.close();
    return;
  }
  if (msg.puzzleId !== ctx.puzzleId) {
    err(ctx, client, "protocol_mismatch", `unknown puzzleId ${msg.puzzleId}`);
    client.ws.close();
    return;
  }

  const lockedCount = await ctx.state.getLockedCount();
  send(ctx, client, {
    t: "welcome",
    userId: client.userId,
    protocolVersion: PROTOCOL_VERSION,
    puzzleId: ctx.puzzleId,
    totalPieces: ctx.meta.totalPieces,
    gridRows: ctx.meta.gridRows,
    gridCols: ctx.meta.gridCols,
    generationSeed: ctx.meta.generationSeed,
    imageManifestUrl: ctx.imageManifestUrl,
    lockedCount,
  });

  const [pieces, groups] = await Promise.all([
    ctx.state.readAllPieces(ctx.meta.totalPieces),
    ctx.state.readAllGroups(ctx.meta.totalPieces),
  ]);
  send(ctx, client, { t: "state", pieces, groups });
}

export async function handleGrab(ctx: Context, client: Client, msg: CGrab): Promise<void> {
  const owner = await ctx.state.tryAcquireGroup(msg.groupId, client.userId);
  if (owner === null) {
    ctx.hub.broadcast({
      t: "grab_ok",
      groupId: msg.groupId,
      userId: client.userId,
    });
    return;
  }
  send(ctx, client, {
    t: "grab_denied",
    groupId: msg.groupId,
    heldBy: owner === "LOCKED" ? "" : owner,
  });
}

export async function handleDrag(ctx: Context, client: Client, msg: CDrag): Promise<void> {
  const g = await ctx.state.readGroup(msg.groupId);
  if (!g) {
    err(ctx, client, "unknown_group", `group ${msg.groupId}`);
    return;
  }
  if (g.heldBy !== client.userId) {
    err(ctx, client, "not_held", `group ${msg.groupId} not held by you`);
    return;
  }
  await ctx.state.setGroupPosition(msg.groupId, msg.worldX, msg.worldY);
  ctx.hub.broadcast(
    {
      t: "drag",
      groupId: msg.groupId,
      worldX: msg.worldX,
      worldY: msg.worldY,
      userId: client.userId,
    },
    client,
  );
}

export async function handleDrop(ctx: Context, client: Client, msg: CDrop): Promise<void> {
  const g = await ctx.state.readGroup(msg.groupId);
  if (!g) {
    err(ctx, client, "unknown_group", `group ${msg.groupId}`);
    return;
  }
  if (g.heldBy !== client.userId) {
    err(ctx, client, "not_held", `group ${msg.groupId} not held by you`);
    return;
  }

  await ctx.state.setGroupPosition(msg.groupId, msg.worldX, msg.worldY);
  g.worldX = msg.worldX;
  g.worldY = msg.worldY;

  const droppedPieces = await ctx.state.getGroupPieces(msg.groupId);
  const match = await detectSnap(
    ctx.state,
    ctx.meta.gridRows,
    ctx.meta.gridCols,
    ctx.meta.snapTolerance,
    g,
    droppedPieces,
  );

  if (!match) {
    await ctx.state.releaseGroup(msg.groupId);
    ctx.hub.broadcast({
      t: "drop",
      groupId: msg.groupId,
      worldX: msg.worldX,
      worldY: msg.worldY,
      userId: client.userId,
    });
    return;
  }

  await applyMerge(
    ctx,
    client,
    msg.groupId,
    droppedPieces,
    match.matchedGroupIds,
    match.targetWorldX,
    match.targetWorldY,
  );
}

async function applyMerge(
  ctx: Context,
  client: Client,
  droppedGroupId: number,
  droppedPieces: number[],
  matchedGroupIds: number[],
  targetWorldX: number,
  targetWorldY: number,
): Promise<void> {
  const allIds = [droppedGroupId, ...matchedGroupIds];
  const newId = Math.min(...allIds);

  const piecesByGroup = new Map<number, number[]>();
  piecesByGroup.set(droppedGroupId, droppedPieces);
  for (const id of matchedGroupIds) {
    piecesByGroup.set(id, await ctx.state.getGroupPieces(id));
  }

  const groupSnapshots = await Promise.all(
    allIds.map(async (id) => ({ id, group: await ctx.state.readGroup(id) })),
  );
  const lockedSizeBefore = groupSnapshots
    .filter((s) => s.group?.locked)
    .reduce((acc, s) => acc + (s.group?.size ?? 0), 0);
  const willBeLocked = lockedSizeBefore > 0;

  const allPieces = allIds.flatMap((id) => piecesByGroup.get(id) ?? []);
  const addedPieceIds = allIds
    .filter((id) => id !== newId)
    .flatMap((id) => piecesByGroup.get(id) ?? []);

  for (const oldId of allIds) {
    if (oldId === newId) continue;
    for (const p of piecesByGroup.get(oldId) ?? []) {
      await ctx.state.setPieceGroup(p, newId);
    }
    await ctx.state.deleteGroup(oldId);
  }

  await ctx.state.addGroupPieces(newId, allPieces);
  await ctx.state.writeGroup({
    id: newId,
    worldX: targetWorldX,
    worldY: targetWorldY,
    size: allPieces.length,
    locked: willBeLocked,
    heldBy: null,
  });

  let lockedCount = await ctx.state.getLockedCount();
  if (willBeLocked) {
    const delta = allPieces.length - lockedSizeBefore;
    if (delta > 0) lockedCount = await ctx.state.addLockedCount(delta);
  }

  const mergeId = randomUUID();
  const at = new Date();
  const hostPieces = piecesByGroup.get(newId) ?? [];
  const targetAnchorPieceId =
    hostPieces.length > 0 ? Math.min(...hostPieces) : (addedPieceIds[0] ?? newId);

  await ctx.mongo.logMerge({
    puzzleId: ctx.puzzleId,
    userId: client.userId,
    addedPieceIds,
    targetAnchorPieceId,
    anchored: willBeLocked,
    at,
  });

  ctx.hub.broadcast({
    t: "snap",
    mergeId,
    newGroupId: newId,
    addedPieceIds,
    worldX: targetWorldX,
    worldY: targetWorldY,
    anchored: willBeLocked,
    userId: client.userId,
    at: at.getTime(),
    lockedCount,
  });
}

export async function dispatch(ctx: Context, client: Client, raw: string): Promise<void> {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    err(ctx, client, "bad_message", "invalid JSON");
    return;
  }
  if (!msg || typeof msg !== "object" || typeof (msg as { t: unknown }).t !== "string") {
    err(ctx, client, "bad_message", "missing message tag");
    return;
  }
  switch (msg.t) {
    case "hello":
      await handleHello(ctx, client, msg);
      return;
    case "grab":
      await handleGrab(ctx, client, msg);
      return;
    case "drag":
      await handleDrag(ctx, client, msg);
      return;
    case "drop":
      await handleDrop(ctx, client, msg);
      return;
    default:
      err(ctx, client, "bad_message", `unknown message type`);
  }
}
