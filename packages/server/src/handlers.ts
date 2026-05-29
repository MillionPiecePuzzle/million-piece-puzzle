import { randomUUID } from "node:crypto";
import type {
  CCursor,
  CDrag,
  CDrop,
  CGrab,
  CHello,
  CSetPseudo,
  CViewport,
  ClientMessage,
  ServerMessage,
} from "@mpp/shared";
import { PROTOCOL_VERSION, normalizePseudo } from "@mpp/shared";
import type { Hub, Client } from "./hub.js";
import type { RedisState, PuzzleMeta } from "./state.js";
import type { MongoLogger } from "./mongo.js";
import { detectSnap } from "./snap.js";

// Cap on leaderboard entries derived on completion. Generous for the closed
// alpha (5 to 20 contributors); bounds the payload once the puzzle scales up.
export const LEADERBOARD_LIMIT = 100;

export type Context = {
  hub: Hub;
  state: RedisState;
  meta: PuzzleMeta;
  puzzleId: string;
  mongo: MongoLogger;
  devEnabled: boolean;
  // Optional during construction (Context is created before PuzzleLifecycle
  // to avoid a circular import). The runtime always wires it before any
  // client message is dispatched.
  lifecycle?: {
    sendWelcomeAndState: (client: Client) => Promise<void>;
    resetCurrent: () => Promise<void>;
    markCompleted: () => Promise<void>;
    forceComplete: () => Promise<void>;
  };
};

function send(ctx: Context, client: Client, msg: ServerMessage): void {
  ctx.hub.send(client, msg);
}

function err(
  ctx: Context,
  client: Client,
  code: "bad_message" | "unknown_group" | "protocol_mismatch" | "not_held" | "dev_disabled",
  message: string,
): void {
  send(ctx, client, { t: "error", code, message });
}

function isValidGroupId(value: unknown, totalPieces: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < totalPieces;
}

function isFiniteCoord(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
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
  // The hello's puzzleId is informational only and ignored: the welcome
  // carries the authoritative current puzzleId.
  if (!ctx.lifecycle) {
    err(ctx, client, "bad_message", "server not ready");
    return;
  }
  await ctx.lifecycle.sendWelcomeAndState(client);
}

export async function handleDevReset(ctx: Context, client: Client): Promise<void> {
  if (!ctx.devEnabled) {
    err(ctx, client, "dev_disabled", "dev controls disabled");
    return;
  }
  if (!ctx.lifecycle) return;
  await ctx.lifecycle.resetCurrent();
}

export async function handleDevComplete(ctx: Context, client: Client): Promise<void> {
  if (!ctx.devEnabled) {
    err(ctx, client, "dev_disabled", "dev controls disabled");
    return;
  }
  if (!ctx.lifecycle) return;
  await ctx.lifecycle.forceComplete();
}

// Pick one random unlocked, unheld cluster and anchor it to the frame origin.
// A piece renders at its group origin plus its solved-cell canonicalOffset, so a
// group whose origin sits at (0,0) is in its correct spot: dropping it there is
// exactly the frame-anchor path, reused here so dev placement emits the same
// snap, merge log, and leaderboard update a human drop would.
export async function handleDevPlace(ctx: Context, client: Client): Promise<void> {
  if (!ctx.devEnabled) {
    err(ctx, client, "dev_disabled", "dev controls disabled");
    return;
  }
  const groups = await ctx.state.readAllGroups(ctx.meta.totalPieces);
  const candidates = groups.filter((g) => !g.locked && g.heldBy === null);
  if (candidates.length === 0) return;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)]!;

  await ctx.state.setGroupPosition(chosen.id, 0, 0);
  chosen.worldX = 0;
  chosen.worldY = 0;

  const droppedPieces = await ctx.state.getGroupPieces(chosen.id);
  const match = await detectSnap(
    ctx.state,
    ctx.meta.gridRows,
    ctx.meta.gridCols,
    ctx.meta.snapTolerance,
    chosen,
    droppedPieces,
  );

  await applyMerge(ctx, client, chosen.id, droppedPieces, match?.matchedGroupIds ?? [], 0, 0, true);
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
  if (owner === "MISSING") {
    err(ctx, client, "unknown_group", `group ${msg.groupId}`);
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
  // Drag is transient: broadcast only, never persisted. The authoritative
  // position is written on drop. Scoped to clients whose viewport covers the
  // event point so a drag does not fan out to the whole canvas.
  ctx.hub.broadcastNear(
    {
      t: "drag",
      groupId: msg.groupId,
      worldX: msg.worldX,
      worldY: msg.worldY,
      userId: client.userId,
    },
    msg.worldX,
    msg.worldY,
    client,
  );
}

export function handleViewport(client: Client, msg: CViewport): void {
  client.viewport = {
    worldX: msg.worldX,
    worldY: msg.worldY,
    worldW: msg.worldW,
    worldH: msg.worldH,
  };
}

export function handleCursor(ctx: Context, client: Client, msg: CCursor): void {
  // Transient awareness: relayed only, never persisted. Scoped to viewport
  // neighbors like drag so a pointer does not fan out to the whole canvas.
  ctx.hub.broadcastNear(
    { t: "cursor", userId: client.userId, worldX: msg.worldX, worldY: msg.worldY },
    msg.worldX,
    msg.worldY,
    client,
  );
}

export function handleSetPseudo(ctx: Context, client: Client, msg: CSetPseudo): void {
  const pseudo = normalizePseudo(msg.pseudo);
  if (pseudo === null) {
    err(ctx, client, "bad_message", "invalid pseudo");
    return;
  }
  client.pseudo = pseudo;
  // Re-announce so peers refresh the pseudo tag on their cursor for this client.
  ctx.hub.broadcast({ t: "join", userId: client.userId, pseudo }, client);
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
  const tol = ctx.meta.snapTolerance;
  const frameAnchor = Math.abs(g.worldX) <= tol && Math.abs(g.worldY) <= tol;
  const match = await detectSnap(
    ctx.state,
    ctx.meta.gridRows,
    ctx.meta.gridCols,
    tol,
    g,
    droppedPieces,
  );

  if (!frameAnchor && !match) {
    await ctx.state.releaseGroup(msg.groupId);
    ctx.hub.broadcastNear(
      {
        t: "drop",
        groupId: msg.groupId,
        worldX: msg.worldX,
        worldY: msg.worldY,
        userId: client.userId,
      },
      msg.worldX,
      msg.worldY,
    );
    return;
  }

  const matchedGroupIds = match?.matchedGroupIds ?? [];
  const targetWorldX = frameAnchor ? 0 : match!.targetWorldX;
  const targetWorldY = frameAnchor ? 0 : match!.targetWorldY;

  await applyMerge(
    ctx,
    client,
    msg.groupId,
    droppedPieces,
    matchedGroupIds,
    targetWorldX,
    targetWorldY,
    frameAnchor,
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
  frameAnchor: boolean,
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
  const willBeLocked = frameAnchor || lockedSizeBefore > 0;

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
  const lockedDelta = willBeLocked ? Math.max(0, allPieces.length - lockedSizeBefore) : 0;
  if (lockedDelta > 0) lockedCount = await ctx.state.addLockedCount(lockedDelta);

  const mergeId = randomUUID();
  const at = new Date();
  const hostPieces = piecesByGroup.get(newId) ?? [];
  const targetAnchorPieceId =
    hostPieces.length > 0 ? Math.min(...hostPieces) : (addedPieceIds[0] ?? newId);

  await ctx.mongo.logMerge({
    puzzleId: ctx.puzzleId,
    userId: client.userId,
    addedPieceIds,
    droppedPieceIds: droppedPieces,
    targetAnchorPieceId,
    anchored: willBeLocked,
    lockedDelta,
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
    pseudo: client.pseudo,
    at: at.getTime(),
    lockedCount,
  });

  // Standings shift on every anchoring snap; rebroadcast so the in-game
  // leaderboard stays live. The aggregation is a full scan of the merge log,
  // acceptable at alpha scale (see DECISIONS).
  if (lockedDelta > 0) {
    const entries = await ctx.mongo.leaderboard(ctx.puzzleId, LEADERBOARD_LIMIT);
    ctx.hub.broadcast({ t: "leaderboard", entries });
  }

  if (willBeLocked && lockedCount >= ctx.meta.totalPieces) {
    await ctx.lifecycle?.markCompleted();
  }
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
      if (!isValidGroupId(msg.groupId, ctx.meta.totalPieces)) {
        err(ctx, client, "bad_message", "invalid groupId");
        return;
      }
      await handleGrab(ctx, client, msg);
      return;
    case "drag":
    case "drop":
      if (!isValidGroupId(msg.groupId, ctx.meta.totalPieces)) {
        err(ctx, client, "bad_message", "invalid groupId");
        return;
      }
      if (!isFiniteCoord(msg.worldX) || !isFiniteCoord(msg.worldY)) {
        err(ctx, client, "bad_message", "invalid coordinates");
        return;
      }
      if (msg.t === "drag") await handleDrag(ctx, client, msg);
      else await handleDrop(ctx, client, msg);
      return;
    case "viewport":
      if (
        !isFiniteCoord(msg.worldX) ||
        !isFiniteCoord(msg.worldY) ||
        !isFiniteCoord(msg.worldW) ||
        !isFiniteCoord(msg.worldH) ||
        msg.worldW < 0 ||
        msg.worldH < 0
      ) {
        err(ctx, client, "bad_message", "invalid viewport");
        return;
      }
      handleViewport(client, msg);
      return;
    case "cursor":
      if (!isFiniteCoord(msg.worldX) || !isFiniteCoord(msg.worldY)) {
        err(ctx, client, "bad_message", "invalid cursor");
        return;
      }
      handleCursor(ctx, client, msg);
      return;
    case "setPseudo":
      handleSetPseudo(ctx, client, msg);
      return;
    case "dev_reset":
      await handleDevReset(ctx, client);
      return;
    case "dev_complete":
      await handleDevComplete(ctx, client);
      return;
    case "dev_place":
      await handleDevPlace(ctx, client);
      return;
    default:
      err(ctx, client, "bad_message", `unknown message type`);
  }
}
