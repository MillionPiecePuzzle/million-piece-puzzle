import { randomUUID } from "node:crypto";
import type {
  CCursor,
  CDrag,
  CDrop,
  CGrab,
  CHello,
  CViewport,
  ClientMessage,
  ServerMessage,
} from "@mpp/shared";
import { PROTOCOL_VERSION } from "@mpp/shared";
import type { Hub, Client } from "./hub.js";
import type { RedisState, PuzzleMeta } from "./state.js";
import type { MongoLogger } from "./mongo.js";
import type { EventLog } from "./eventLog.js";
import type { GroupQueue } from "./queue.js";
import type { GroupIndex } from "./groupIndex.js";
import { detectSnap } from "./snap.js";
import { localAabbForPieces, worldAabbFor } from "./worldGrid.js";

// Cap on leaderboard entries derived on completion. Generous for the closed
// alpha (5 to 20 contributors); bounds the payload once the puzzle scales up.
export const LEADERBOARD_LIMIT = 100;

export type Context = {
  hub: Hub;
  state: RedisState;
  meta: PuzzleMeta;
  puzzleId: string;
  mongo: MongoLogger;
  // Ordered log of spectator-visible drops and snaps, recorded at the
  // authoritative emission points so the spectator stream replays them in order.
  eventLog: EventLog;
  devEnabled: boolean;
  eventStartsAt: number;
  queue: GroupQueue;
  // In-process spatial index of group positions, keyed on the broadcast cell
  // grid. Maintained on every committed position change (drop, merge) and read by
  // handleViewport to resync a client panning into new cells.
  groupIndex: GroupIndex;
  // Max pieces allowed to rest in one broadcast cell. A non-merging drop that
  // would push the destination cell past this is rejected (see handleDrop).
  tilePieceCap: number;
  // Optional during construction (Context is created before PuzzleLifecycle
  // to avoid a circular import). The runtime always wires it before any
  // client message is dispatched.
  lifecycle?: {
    sendWelcome: (client: Client) => Promise<void>;
    resetCurrent: () => Promise<void>;
    markCompleted: () => Promise<void>;
    forceComplete: (userId: string) => Promise<void>;
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
  await ctx.lifecycle.sendWelcome(client);
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
  await ctx.lifecycle.forceComplete(client.userId);
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
    client.held.add(msg.groupId);
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
  // position is written on drop. Scoped to clients whose viewport overlaps the
  // cluster's world AABB (local AABB translated by the live drag position) so a
  // drag does not fan out to the whole canvas, yet reaches a peer the body covers
  // even when the origin is off their screen.
  ctx.hub.broadcastOverlapping(
    {
      t: "drag",
      groupId: msg.groupId,
      worldX: msg.worldX,
      worldY: msg.worldY,
      userId: client.userId,
    },
    worldAabbFor(g.localAabb, msg.worldX, msg.worldY),
    client,
  );
}

export async function handleViewport(ctx: Context, client: Client, msg: CViewport): Promise<void> {
  client.viewport = {
    worldX: msg.worldX,
    worldY: msg.worldY,
    worldW: msg.worldW,
    worldH: msg.worldH,
  };
  // Move the client to the cells its new viewport overlaps (or the global set if
  // it has none yet / overlaps too many), diffing in O(cells). A global
  // subscriber (the default fit viewport at scale) enters no cells and streams
  // nothing by design: sending it the whole board is exactly the full-state push
  // protocol v3 removes; the minimap carries its overview meanwhile.
  const entered = ctx.hub.updateSubscription(client);
  if (entered.length === 0) return;
  // Build the region_state construction stream for the groups in the newly
  // entered cells (a cell the client already held is not re-sent). Position,
  // size and locked come from the in-memory index; piece ids are the singleton's
  // own id when size === 1 (a size-1 group never merged, so it holds exactly the
  // piece whose id equals the group id) and a Redis read for the few size > 1
  // groups, so the common singleton case needs no read. The client builds an
  // unknown group and additively reconciles a known one (see the stage upsert).
  const groups = ctx.groupIndex.collect(entered);
  const construction =
    groups.length === 0
      ? []
      : await Promise.all(
          groups.map(async (g) => ({
            groupId: g.groupId,
            worldX: g.worldX,
            worldY: g.worldY,
            locked: g.locked,
            size: g.size,
            pieceIds: g.size === 1 ? [g.groupId] : await ctx.state.getGroupPieces(g.groupId),
          })),
        );
  // The whole bounded viewport is subscribed now, so its area is "known" to the
  // client even where it held no groups. Always ack it (even with an empty
  // construction) so the client can distinguish a not-yet-streamed region from an
  // empty one and clear its loading indicator.
  const coverage = {
    minX: msg.worldX,
    minY: msg.worldY,
    maxX: msg.worldX + msg.worldW,
    maxY: msg.worldY + msg.worldH,
  };
  send(ctx, client, { t: "region_state", groups: construction, coverage });
}

export function handleCursor(ctx: Context, client: Client, msg: CCursor): void {
  // Transient awareness: relayed only, never persisted. Stays point-based (a
  // zero-size rect) so a pointer does not fan out to the whole canvas.
  ctx.hub.broadcastOverlapping(
    { t: "cursor", userId: client.userId, worldX: msg.worldX, worldY: msg.worldY },
    { minX: msg.worldX, minY: msg.worldY, maxX: msg.worldX, maxY: msg.worldY },
    client,
  );
}

// A merge mutates every group it joins, so it has to run holding all their
// locks. The dropped group's neighbours are only known after detectSnap, so
// when `handleDrop` runs under the per-group queue (callers pass `lockedGroups`)
// and the snap reaches a group we do not yet hold, it returns the full set to
// lock and mutates nothing, letting the caller re-run holding the expanded set.
// A direct call (no `lockedGroups`) assumes the caller already holds whatever it
// needs and always applies.
export type DropOutcome = { expand: number[] } | void;

export async function handleDrop(
  ctx: Context,
  client: Client,
  msg: CDrop,
  lockedGroups?: ReadonlySet<number>,
): Promise<DropOutcome> {
  const g = await ctx.state.readGroup(msg.groupId);
  if (!g) {
    err(ctx, client, "unknown_group", `group ${msg.groupId}`);
    return;
  }
  if (g.heldBy !== client.userId) {
    err(ctx, client, "not_held", `group ${msg.groupId} not held by you`);
    return;
  }

  // The pre-drag resting position (drags are transient and never persisted, so
  // Redis still holds it), kept as the rollback target if the drop is rejected.
  const prevX = g.worldX;
  const prevY = g.worldY;

  // Detection only: position is set in memory so detectSnap sees the drop point,
  // but nothing is persisted until we know all involved groups are locked.
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
  const matchedGroupIds = match?.matchedGroupIds ?? [];

  if (lockedGroups) {
    const required = [msg.groupId, ...matchedGroupIds];
    if (required.some((id) => !lockedGroups.has(id))) return { expand: required };
  }

  // The hold ends here whether the drop just releases the group or merges it
  // away, so drop it from the connection's held set (see Client.held).
  client.held.delete(msg.groupId);

  // Per-tile piece cap: reject a non-merging drop that would push the destination
  // cell past the cap, so a zoomed-out LOD tile never has to bake an unbounded
  // pile (which defeats the LOD). Merges and frame anchors are exempt: a merge
  // removes a loose cluster and an anchor locks to the frame. Checked before the
  // position is persisted, so a rejected drop leaves Redis untouched.
  if (!frameAnchor && !match) {
    const rest = worldAabbFor(g.localAabb, msg.worldX, msg.worldY);
    const cellPieces = ctx.groupIndex.cellPieceCount(rest.minX, rest.minY, msg.groupId);
    if (cellPieces + g.size > ctx.tilePieceCap) {
      await ctx.state.releaseGroup(msg.groupId);
      // Bounce the cluster back: the dropper learns why (flash + toast), the
      // neighbours who watched the drag get a plain position correction.
      send(ctx, client, {
        t: "rollback",
        groupId: msg.groupId,
        worldX: prevX,
        worldY: prevY,
        reason: "tile_full",
      });
      ctx.hub.broadcastOverlapping(
        { t: "rollback", groupId: msg.groupId, worldX: prevX, worldY: prevY },
        rest,
        client,
      );
      return;
    }
  }

  await ctx.state.setGroupPosition(msg.groupId, msg.worldX, msg.worldY);

  if (!frameAnchor && !match) {
    await ctx.state.releaseGroup(msg.groupId);
    // The group's resting position changed without a merge: update the group
    // index so a peer panning into the new region resyncs to it. The cell is
    // keyed by the body min, the payload reports the origin. Done before the
    // broadcast so a concurrent viewport read never sees a stale position for a
    // group whose drop has already gone out.
    const rest = worldAabbFor(g.localAabb, msg.worldX, msg.worldY);
    ctx.groupIndex.set(msg.groupId, rest.minX, rest.minY, {
      originX: msg.worldX,
      originY: msg.worldY,
      size: g.size,
      locked: false,
    });
    ctx.hub.broadcastOverlapping(
      {
        t: "drop",
        groupId: msg.groupId,
        worldX: msg.worldX,
        worldY: msg.worldY,
        userId: client.userId,
      },
      worldAabbFor(g.localAabb, msg.worldX, msg.worldY),
    );
    // Spectator stream: a non-merging drop is broadcast only and not persisted in
    // Redis history, so log it for the event window the spectator interpolates.
    await ctx.eventLog.recordDrop({
      groupId: msg.groupId,
      worldX: msg.worldX,
      worldY: msg.worldY,
    });
    return;
  }

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
    // The merged-away group no longer exists, so drop it from the group index.
    ctx.groupIndex.remove(oldId);
  }

  await ctx.state.addGroupPieces(newId, allPieces);
  // The merged cluster's footprint changes here, so recompute its group-local
  // AABB once from the union of member pieces and store it on the group. The drag
  // hot path then reads it with the group, no per-frame piece scan.
  const mergedLocalAabb = localAabbForPieces(allPieces, ctx.meta.gridCols, ctx.meta.pieceSize);
  await ctx.state.writeGroup({
    id: newId,
    worldX: targetWorldX,
    worldY: targetWorldY,
    size: allPieces.length,
    locked: willBeLocked,
    heldBy: null,
    localAabb: mergedLocalAabb,
  });
  // Re-key the surviving group to its new footprint and position in the index. A
  // merge is globally broadcast, so a peer already learns of it; indexing it
  // keeps the read model consistent (and harmlessly idempotent) for later resyncs,
  // and serves the construction payload when a client pans into its cell.
  const mergedRest = worldAabbFor(mergedLocalAabb, targetWorldX, targetWorldY);
  ctx.groupIndex.set(newId, mergedRest.minX, mergedRest.minY, {
    originX: targetWorldX,
    originY: targetWorldY,
    size: allPieces.length,
    locked: willBeLocked,
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

  // Spectator stream: mirror the snap into the event log so spectators replay it
  // in order (animation, locked count, activity ticker). Same fields as the WS
  // snap so the client reuses applySnap + recordSnap unchanged.
  await ctx.eventLog.recordSnap({
    at: at.getTime(),
    mergeId,
    newGroupId: newId,
    addedPieceIds,
    worldX: targetWorldX,
    worldY: targetWorldY,
    anchored: willBeLocked,
    userId: client.userId,
    pseudo: client.pseudo,
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

// Upper bound on lock-set expansions for one drop. Each pass adds at least one
// neighbour group, so it terminates; the cap only guards the pathological case
// where concurrent merges keep moving fresh groups into snap range between
// passes (effectively impossible at any real rate).
const MAX_MERGE_LOCK_ATTEMPTS = 8;

// Run a drop under the per-group queue. The first pass locks only the dropped
// group; if the snap reaches groups it does not hold, `handleDrop` reports them
// and the drop re-runs holding the union, until the whole merge is covered.
async function scheduleDrop(ctx: Context, client: Client, msg: CDrop): Promise<void> {
  const locked = new Set<number>([msg.groupId]);
  for (let attempt = 0; attempt < MAX_MERGE_LOCK_ATTEMPTS; attempt++) {
    let expand: number[] | undefined;
    await ctx.queue.run("drop", [...locked], async () => {
      const outcome = await handleDrop(ctx, client, msg, locked);
      if (outcome) expand = outcome.expand;
    });
    if (!expand) return;
    for (const id of expand) locked.add(id);
  }
  console.error(`[queue:drop] gave up expanding merge locks for group ${msg.groupId}`);
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
      // Protocol v3: welcome carries no board, so hello no longer reads all
      // groups and needs no global barrier. It only reads lockedCount plus the
      // Mongo activity/leaderboard and the latest minimap grid; the board streams
      // per viewport via region_state.
      await handleHello(ctx, client, msg);
      return;
    case "grab":
      if (!isValidGroupId(msg.groupId, ctx.meta.totalPieces)) {
        err(ctx, client, "bad_message", "invalid groupId");
        return;
      }
      await ctx.queue.run("grab", [msg.groupId], () => handleGrab(ctx, client, msg));
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
      if (msg.t === "drag")
        await ctx.queue.run("drag", [msg.groupId], () => handleDrag(ctx, client, msg));
      else await scheduleDrop(ctx, client, msg);
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
      await handleViewport(ctx, client, msg);
      return;
    case "cursor":
      if (!isFiniteCoord(msg.worldX) || !isFiniteCoord(msg.worldY)) {
        err(ctx, client, "bad_message", "invalid cursor");
        return;
      }
      handleCursor(ctx, client, msg);
      return;
    case "dev_reset":
      await runDev(ctx, "dev_reset", () => handleDevReset(ctx, client));
      return;
    case "dev_complete":
      await runDev(ctx, "dev_complete", () => handleDevComplete(ctx, client));
      return;
    case "dev_place":
      await runDev(ctx, "dev_place", () => handleDevPlace(ctx, client));
      return;
    default:
      err(ctx, client, "bad_message", `unknown message type`);
  }
}

// Dev commands rewrite the whole board (reset, force-complete) or scan it to
// pick a target (place), so they take the global barrier when enabled. When
// disabled the handler just emits `dev_disabled`, so it runs inline rather than
// serializing the board behind a rejected command.
function runDev(ctx: Context, label: string, fn: () => Promise<void>): Promise<void> {
  return ctx.devEnabled ? ctx.queue.runGlobal(label, fn) : fn();
}
