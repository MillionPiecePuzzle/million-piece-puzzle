import { randomUUID } from "node:crypto";
import type { CCursor, CHello, CViewport, ClientMessage, ServerMessage } from "@mpp/shared";
import { PROTOCOL_VERSION, type MinimapGridTracker } from "@mpp/shared";
import type { Hub, Client } from "./hub.js";
import type { RedisState, PuzzleMeta } from "./state.js";
import type { MongoLogger } from "./mongo.js";
import type { GroupQueue } from "./queue.js";
import type { GroupIndex } from "./groupIndex.js";
import { detectSnap } from "./snap.js";
import { localAabbForPieces, worldAabbFor } from "./worldGrid.js";
import { batchEnteredCells, sleep } from "./regionStream.js";
import {
  type WireContext,
  toWireId,
  toGridId,
  anchorWorldX,
  anchorWorldY,
  originXFromAnchor,
  originYFromAnchor,
  wirePieces,
} from "./wire.js";

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
  eventStartsAt: number;
  // Server-only generation seed (never in the public manifest), used to derive the
  // scatter and play zone on init/reset. Geometry and the id permutation both
  // descend from it.
  generationSeed: string;
  queue: GroupQueue;
  // The wire boundary context (the seed permutation plus gridCols/pieceSize).
  // Every outbound id/position is encoded through it and every inbound one decoded,
  // so handlers run purely in grid-id + internal-origin space (see wire.ts).
  wire: WireContext;
  // In-process spatial index of group positions, keyed on the shared world grid
  // cell. Maintained on every committed position change (drop, merge) and read by
  // handleViewport to resync a client panning into new cells.
  groupIndex: GroupIndex;
  // Incrementally-maintained minimap density grid (see DECISIONS: server-computed
  // minimap grid). Updated on every committed position/lock change (drop, merge)
  // instead of the periodic snapshot re-scanning the whole board; rebuilt from
  // scratch at boot, reset, force-complete, and a slow defense-in-depth resync.
  minimapGrid: MinimapGridTracker;
  // Max pieces allowed to rest in one world grid cell (one LOD tile). A non-merging
  // drop that would push the destination cell past this is rejected (see handleDrop).
  tilePieceCap: number;
  // Viewport scoping bound (config.broadcastMaxCells), carried in welcome so the
  // contributor client mirrors the scoped-vs-global decision for its loading cover.
  broadcastMaxCells: number;
  // World-grid cell size the Hub and GroupIndex were both built with (see
  // DECISIONS: spatial broadcast index). Needed here to convert a region_state
  // batch's column/row range back to world coordinates for its coverage rect.
  worldTileSize: number;
  // Target cell count per region_state batch when a viewport's newly entered
  // cells are paced across multiple messages (see DECISIONS: paced region_state
  // batching).
  regionStreamBatchCells: number;
  // ws.bufferedAmount ceiling (bytes) a paced region_state stream waits under
  // before sending its next batch.
  regionStreamPaceThresholdBytes: number;
  // Poll interval (ms) while a paced region_state stream waits for
  // bufferedAmount to clear.
  regionStreamPollIntervalMs: number;
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
  const prevX = chosen.worldX;
  const prevY = chosen.worldY;

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

  await applyMerge(
    ctx,
    client,
    chosen.id,
    droppedPieces,
    match?.matchedGroupIds ?? [],
    0,
    0,
    true,
    prevX,
    prevY,
  );
}

// `groupId` is the decoded grid id (dispatch maps the wire id before queueing);
// the broadcast grab_ok/grab_denied re-encode it to the wire id every client knows.
// The caller (dispatch) has already added `groupId` to `client.held` synchronously,
// before this ever reaches the queue: a disconnect racing this call still finds
// the id and releases it once this settles, instead of the hold outliving the
// connection that requested it (see DECISIONS). Success simply keeps that
// reservation; every non-success path other than "already held by this same
// client" (a redundant grab) drops it again.
export async function handleGrab(ctx: Context, client: Client, groupId: number): Promise<void> {
  const owner = await ctx.state.tryAcquireGroup(groupId, client.userId);
  if (owner === null) {
    ctx.hub.broadcast({
      t: "grab_ok",
      groupId: toWireId(ctx.wire, groupId),
      userId: client.userId,
    });
    return;
  }
  if (owner !== client.userId) client.held.delete(groupId);
  if (owner === "MISSING") {
    err(ctx, client, "unknown_group", `group ${groupId}`);
    return;
  }
  send(ctx, client, {
    t: "grab_denied",
    groupId: toWireId(ctx.wire, groupId),
    heldBy: owner === "LOCKED" ? "" : owner,
  });
}

// `groupId` is the decoded grid id; `originX`/`originY` are the internal origin
// decoded from the client's anchor world position. The broadcast re-encodes both.
export async function handleDrag(
  ctx: Context,
  client: Client,
  groupId: number,
  originX: number,
  originY: number,
): Promise<void> {
  const g = await ctx.state.readGroup(groupId);
  if (!g) {
    err(ctx, client, "unknown_group", `group ${groupId}`);
    return;
  }
  if (g.heldBy !== client.userId) {
    err(ctx, client, "not_held", `group ${groupId} not held by you`);
    return;
  }
  // Drag is transient: broadcast only, never persisted. The authoritative
  // position is written on drop. Scoped to clients whose viewport overlaps the
  // cluster's world AABB (local AABB translated by the live drag origin) so a
  // drag does not fan out to the whole canvas, yet reaches a peer the body covers
  // even when the anchor is off their screen.
  ctx.hub.broadcastOverlapping(
    {
      t: "drag",
      groupId: toWireId(ctx.wire, groupId),
      worldX: anchorWorldX(ctx.wire, groupId, originX),
      worldY: anchorWorldY(ctx.wire, groupId, originY),
      userId: client.userId,
    },
    worldAabbFor(g.localAabb, originX, originY),
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
  // Bumped synchronously (before any await) so a later `viewport` on this same
  // connection always captures a strictly greater value and supersedes this
  // stream (see DECISIONS: paced region_state batching).
  const mySeq = ++client.regionStreamSeq;
  await streamRegionState(ctx, client, entered, mySeq);
}

// Sends the region_state construction stream for a viewport's newly entered
// cells as several paced batches instead of one, so a large jump on a
// fragmented board (every piece its own group) does not risk the WS
// backpressure close (Hub.write's slow-consumer guard). Batches are disjoint
// world-grid column ranges (see regionStream.ts), so each batch's coverage is
// safe to mark "known" as soon as it is sent, even before the whole stream
// finishes. Stops silently (no error) the moment this stream is superseded by
// a newer `viewport` on the same connection, or the connection is gone.
async function streamRegionState(
  ctx: Context,
  client: Client,
  entered: number[],
  mySeq: number,
): Promise<void> {
  const batches = batchEnteredCells(entered, ctx.worldTileSize, ctx.regionStreamBatchCells);
  for (let i = 0; i < batches.length; i++) {
    if (i > 0) {
      // Pace: never send two batches in the same tick (splitting alone does not
      // help, ws.bufferedAmount only drops between real event-loop ticks), then
      // keep waiting while the buffer is still over the pacing threshold.
      do {
        await sleep(ctx.regionStreamPollIntervalMs);
        if (client.regionStreamSeq !== mySeq) return;
        if (client.ws.readyState !== client.ws.OPEN) return;
      } while (client.ws.bufferedAmount > ctx.regionStreamPaceThresholdBytes);
    }
    if (client.regionStreamSeq !== mySeq || client.ws.readyState !== client.ws.OPEN) return;
    const batch = batches[i]!;
    // Build the region_state construction entries for this batch's groups.
    // Position, size and locked come from the in-memory index; piece ids are
    // the singleton's own id when size === 1 (a size-1 group never merged, so
    // it holds exactly the piece whose id equals the group id) and a Redis read
    // for the few size > 1 groups, so the common singleton case needs no read.
    const groups = ctx.groupIndex.collect(batch.cells);
    const construction = await Promise.all(
      groups.map(async (g) => {
        const pieceGridIds = g.size === 1 ? [g.groupId] : await ctx.state.getGroupPieces(g.groupId);
        return {
          groupId: toWireId(ctx.wire, g.groupId),
          worldX: anchorWorldX(ctx.wire, g.groupId, g.worldX),
          worldY: anchorWorldY(ctx.wire, g.groupId, g.worldY),
          locked: g.locked,
          size: g.size,
          pieces: wirePieces(ctx.wire, g.groupId, pieceGridIds),
        };
      }),
    );
    // Re-check after the Redis round trip: a supersession or disconnect could
    // have landed while awaiting it.
    if (client.regionStreamSeq !== mySeq || client.ws.readyState !== client.ws.OPEN) return;
    // This batch's cells are "known" now, even where it held no groups: the
    // client distinguishes a not-yet-streamed region from an empty one by this
    // coverage rect, scoped to exactly the cells just sent (not the client's
    // whole requested viewport, which can be wider than this batch, or than the
    // stream as a whole when panning only entered a thin band of it).
    send(ctx, client, { t: "region_state", groups: construction, coverage: batch.coverage });
  }
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
  groupId: number,
  originX: number,
  originY: number,
  lockedGroups?: ReadonlySet<number>,
): Promise<DropOutcome> {
  const g = await ctx.state.readGroup(groupId);
  if (!g) {
    err(ctx, client, "unknown_group", `group ${groupId}`);
    return;
  }
  if (g.heldBy !== client.userId) {
    err(ctx, client, "not_held", `group ${groupId} not held by you`);
    return;
  }

  // The pre-drag resting origin (drags are transient and never persisted, so
  // Redis still holds it), kept as the rollback target if the drop is rejected.
  const prevX = g.worldX;
  const prevY = g.worldY;

  // Detection only: origin is set in memory so detectSnap sees the drop point,
  // but nothing is persisted until we know all involved groups are locked.
  g.worldX = originX;
  g.worldY = originY;

  const droppedPieces = await ctx.state.getGroupPieces(groupId);
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
    const required = [groupId, ...matchedGroupIds];
    if (required.some((id) => !lockedGroups.has(id))) return { expand: required };
  }

  // The hold ends here whether the drop just releases the group or merges it
  // away, so drop it from the connection's held set (see Client.held).
  client.held.delete(groupId);

  // Per-tile piece cap: reject a non-merging drop that would push the destination
  // cell past the cap, so a zoomed-out LOD tile never has to bake an unbounded
  // pile (which defeats the LOD). Merges and frame anchors are exempt: a merge
  // removes a loose cluster and an anchor locks to the frame. Checked before the
  // position is persisted, so a rejected drop leaves Redis untouched.
  if (!frameAnchor && !match) {
    const rest = worldAabbFor(g.localAabb, originX, originY);
    const cellPieces = ctx.groupIndex.cellPieceCount(rest.minX, rest.minY, groupId);
    if (cellPieces + g.size > ctx.tilePieceCap) {
      await ctx.state.releaseGroup(groupId);
      // Bounce the cluster back to its pre-drag origin (encoded as the anchor
      // world position): the dropper learns why (flash + toast), the neighbours
      // who watched the drag get a plain position correction.
      const wireId = toWireId(ctx.wire, groupId);
      const bounceX = anchorWorldX(ctx.wire, groupId, prevX);
      const bounceY = anchorWorldY(ctx.wire, groupId, prevY);
      send(ctx, client, {
        t: "rollback",
        groupId: wireId,
        worldX: bounceX,
        worldY: bounceY,
        reason: "tile_full",
      });
      ctx.hub.broadcastOverlapping(
        { t: "rollback", groupId: wireId, worldX: bounceX, worldY: bounceY },
        rest,
        client,
      );
      return;
    }
  }

  await ctx.state.setGroupPosition(groupId, originX, originY);

  if (!frameAnchor && !match) {
    await ctx.state.releaseGroup(groupId);
    // The group's resting position changed without a merge: update the group
    // index so a peer panning into the new region resyncs to it. The cell is
    // keyed by the body min, the payload reports the origin. Done before the
    // broadcast so a concurrent viewport read never sees a stale position for a
    // group whose drop has already gone out.
    const rest = worldAabbFor(g.localAabb, originX, originY);
    ctx.groupIndex.set(groupId, rest.minX, rest.minY, {
      originX,
      originY,
      size: g.size,
      locked: false,
    });
    ctx.minimapGrid.applyTranslation(
      droppedPieces,
      { originX: prevX, originY: prevY, locked: false },
      { originX, originY, locked: false },
    );
    ctx.hub.broadcastOverlapping(
      {
        t: "drop",
        groupId: toWireId(ctx.wire, groupId),
        worldX: anchorWorldX(ctx.wire, groupId, originX),
        worldY: anchorWorldY(ctx.wire, groupId, originY),
        userId: client.userId,
      },
      rest,
    );
    return;
  }

  const targetWorldX = frameAnchor ? 0 : match!.targetWorldX;
  const targetWorldY = frameAnchor ? 0 : match!.targetWorldY;

  await applyMerge(
    ctx,
    client,
    groupId,
    droppedPieces,
    matchedGroupIds,
    targetWorldX,
    targetWorldY,
    frameAnchor,
    prevX,
    prevY,
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
  droppedPrevX: number,
  droppedPrevY: number,
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

  // Every group folding into this merge moves (or stays put) to the same target.
  // The dropped group's own pre-merge snapshot was already overwritten in Redis
  // by handleDrop's setGroupPosition before this ran, so its "from" state has to
  // come from the caller (droppedPrevX/Y) rather than groupSnapshots; every other
  // matched group's snapshot is untouched by this operation and is used as-is
  // (a candidate can sit up to snapTolerance away from the target, so this may
  // move it a few pixels too, not just relabel it).
  const to = { originX: targetWorldX, originY: targetWorldY, locked: willBeLocked };
  for (const { id, group } of groupSnapshots) {
    if (!group) continue;
    const from =
      id === droppedGroupId
        ? { originX: droppedPrevX, originY: droppedPrevY, locked: false }
        : { originX: group.worldX, originY: group.worldY, locked: group.locked };
    ctx.minimapGrid.applyTranslation(piecesByGroup.get(id) ?? [], from, to);
  }

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
    mergedSize: allPieces.length,
    at,
  });

  // Encode the merge for the wire once: the permuted surviving group id, the
  // anchor world position from the internal target origin, and the added pieces
  // with their grid-unit offsets from the new anchor. The same encoded shape feeds
  // the live snap broadcast.
  const wireNewGroupId = toWireId(ctx.wire, newId);
  const wireWorldX = anchorWorldX(ctx.wire, newId, targetWorldX);
  const wireWorldY = anchorWorldY(ctx.wire, newId, targetWorldY);
  const wireAddedPieces = wirePieces(ctx.wire, newId, addedPieceIds);

  ctx.hub.broadcast({
    t: "snap",
    mergeId,
    newGroupId: wireNewGroupId,
    addedPieceIds: wireAddedPieces,
    worldX: wireWorldX,
    worldY: wireWorldY,
    anchored: willBeLocked,
    droppedSize: droppedPieces.length,
    mergedSize: allPieces.length,
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

// Upper bound on lock-set expansions for one drop. Each pass adds at least one
// neighbour group, so it terminates; the cap only guards the pathological case
// where concurrent merges keep moving fresh groups into snap range between
// passes (effectively impossible at any real rate).
const MAX_MERGE_LOCK_ATTEMPTS = 8;

// Run a drop under the per-group queue. The first pass locks only the dropped
// group; if the snap reaches groups it does not hold, `handleDrop` reports them
// and the drop re-runs holding the union, until the whole merge is covered.
// `groupId` is the decoded grid id and `originX`/`originY` the decoded internal
// origin (dispatch translates the wire message before this runs).
async function scheduleDrop(
  ctx: Context,
  client: Client,
  groupId: number,
  originX: number,
  originY: number,
): Promise<void> {
  const locked = new Set<number>([groupId]);
  for (let attempt = 0; attempt < MAX_MERGE_LOCK_ATTEMPTS; attempt++) {
    let expand: number[] | undefined;
    await ctx.queue.run("drop", [...locked], async () => {
      const outcome = await handleDrop(ctx, client, groupId, originX, originY, locked);
      if (outcome) expand = outcome.expand;
    });
    if (!expand) return;
    for (const id of expand) locked.add(id);
  }
  console.error(`[queue:drop] gave up expanding merge locks for group ${groupId}`);
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
    case "grab": {
      // The wire groupId is validated in the wire id range (which equals the grid
      // range), then decoded to the grid id the queue and handlers run on.
      if (!isValidGroupId(msg.groupId, ctx.meta.totalPieces)) {
        err(ctx, client, "bad_message", "invalid groupId");
        return;
      }
      const gridId = toGridId(ctx.wire, msg.groupId);
      // Reserve synchronously, before the queue (and the Redis round trip inside
      // it) ever runs: a disconnect racing this grab then still sees the id in
      // client.held and releases it, instead of the acquire winning after the
      // disconnect cleanup already took its snapshot (see DECISIONS). handleGrab
      // drops the reservation again on anything but a win.
      client.held.add(gridId);
      await ctx.queue.run("grab", [gridId], () => handleGrab(ctx, client, gridId));
      return;
    }
    case "drag":
    case "drop": {
      if (!isValidGroupId(msg.groupId, ctx.meta.totalPieces)) {
        err(ctx, client, "bad_message", "invalid groupId");
        return;
      }
      if (!isFiniteCoord(msg.worldX) || !isFiniteCoord(msg.worldY)) {
        err(ctx, client, "bad_message", "invalid coordinates");
        return;
      }
      // Decode: wire groupId -> grid id, and the client's anchor world position ->
      // the internal origin handlers operate on.
      const gridId = toGridId(ctx.wire, msg.groupId);
      const originX = originXFromAnchor(ctx.wire, gridId, msg.worldX);
      const originY = originYFromAnchor(ctx.wire, gridId, msg.worldY);
      if (msg.t === "drag")
        await ctx.queue.run("drag", [gridId], () =>
          handleDrag(ctx, client, gridId, originX, originY),
        );
      else await scheduleDrop(ctx, client, gridId, originX, originY);
      return;
    }
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
