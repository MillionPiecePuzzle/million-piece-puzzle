import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { Redis as IORedis } from "ioredis";
import { WebSocketServer, type WebSocket, type VerifyClientCallbackSync } from "ws";
import { PROTOCOL_VERSION } from "@mpp/shared";
import { loadConfig } from "./config.js";
import { Hub, type Client } from "./hub.js";
import { RedisState } from "./state.js";
import { MongoLogger } from "./mongo.js";
import { dispatch, LEADERBOARD_LIMIT, type Context } from "./handlers.js";
import { GroupQueue } from "./queue.js";
import { ACTIVITY_BACKFILL_LIMIT, PuzzleLifecycle } from "./lifecycle.js";
import { initPuzzleIfEmpty } from "./init.js";
import { IpRegistry, isAllowedOrigin, clientIp } from "./limits.js";
import { SnapshotPublisher, makeSnapshotHandler } from "./snapshot.js";

// WebSocket close code 1013 ("Try Again Later"), used to refuse a connection
// that exceeds the per-IP concurrent-connection cap.
const CLOSE_TRY_AGAIN_LATER = 1013;

async function main(): Promise<void> {
  const config = await loadConfig();

  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  redis.on("error", (e: Error) => console.error("[redis]", e.message));

  const mongo = new MongoLogger(config.mongoUrl, config.mongoDb);
  await mongo.connect();

  const manifest = config.manifest;
  const state = new RedisState(redis, manifest.puzzleId);
  const meta = await initPuzzleIfEmpty(state, manifest);

  const hub = new Hub(config.wsBufferedAmountLimitBytes);
  // Per-group dispatch queues: messages for different groups run concurrently,
  // a group's own messages stay ordered, and a merge serializes against every
  // group it joins (see DECISIONS: per-group dispatch queues).
  const queue = new GroupQueue();
  const ctx: Context = {
    hub,
    state,
    meta,
    puzzleId: manifest.puzzleId,
    mongo,
    devEnabled: config.devEnabled,
    queue,
  };
  const lifecycle = new PuzzleLifecycle(ctx, manifest);
  ctx.lifecycle = lifecycle;

  console.log(
    `[boot] puzzle=${ctx.puzzleId} pieces=${ctx.meta.totalPieces} (${ctx.meta.gridCols}x${ctx.meta.gridRows}) protocol=v${PROTOCOL_VERSION} dev=${config.devEnabled}`,
  );

  if (config.allowedOrigins.length === 1 && config.allowedOrigins[0] === "*") {
    console.warn(
      "[ws] MPP_ALLOWED_ORIGINS unset, accepting any Origin. Set it to your frontend origin(s) for production.",
    );
  }

  // Periodic snapshot for spectator mode, served via HTTP and cached by the
  // CDN edge. The publisher keeps the latest body in memory; the HTTP handler
  // serves it without re-querying Redis on each request.
  const snapshotPublisher = new SnapshotPublisher(config.snapshotIntervalMs, {
    state,
    puzzleId: () => ctx.puzzleId,
    totalPieces: () => ctx.meta.totalPieces,
    playZone: () => lifecycle.currentPlayZone(),
    leaderboard: () => mongo.leaderboard(ctx.puzzleId, LEADERBOARD_LIMIT),
    activity: () => mongo.recentAnchoredMerges(ctx.puzzleId, ACTIVITY_BACKFILL_LIMIT),
  });
  snapshotPublisher.start();
  const handleSnapshot = makeSnapshotHandler(snapshotPublisher, config.snapshotIntervalMs);

  // One HTTP server hosts both the spectator snapshot endpoint and the
  // WebSocket upgrade. WS upgrades bypass the request handler; HTTP requests
  // not matched by a handler get a 404.
  const httpServer = createServer((req, res) => {
    if (handleSnapshot(req, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  const verifyClient: VerifyClientCallbackSync = (info) =>
    isAllowedOrigin(info.origin, config.allowedOrigins);
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: config.wsMaxPayloadBytes,
    verifyClient,
  });
  httpServer.listen(config.port, () => {
    console.log(
      `[http] listening on ${config.port} (ws upgrade + GET /snapshot, snapshot interval ${config.snapshotIntervalMs}ms)`,
    );
  });

  // Per-IP budget shared across an IP's connections: one message-rate bucket
  // and a concurrent-connection cap (see DECISIONS: WS hardening).
  const ipRegistry = new IpRegistry(
    config.wsMaxConnectionsPerIp,
    config.wsRateBurst,
    config.wsRateTokensPerSec,
  );

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const ip = clientIp(request, config.devEnabled);
    const bucket = ipRegistry.acquire(ip);
    if (bucket === null) {
      // Over the per-IP concurrent-connection cap: refuse before adding the
      // client so one IP cannot hold more than its budget of sessions open.
      ws.close(CLOSE_TRY_AGAIN_LATER, "too many connections");
      return;
    }
    const client: Client = { userId: randomUUID(), ws, bucket, viewport: null, pseudo: null };
    // Presence: tell the newcomer about peers already present, then announce
    // the newcomer to them. join and leave bracket a connection.
    for (const peer of hub.allClients()) {
      hub.send(client, { t: "join", userId: peer.userId, pseudo: peer.pseudo });
    }
    hub.add(client);
    hub.broadcast({ t: "join", userId: client.userId, pseudo: client.pseudo }, client);

    ws.on("message", (data) => {
      // The bucket is shared by every connection from this IP, so messages over
      // the per-IP rate are dropped silently to avoid amplifying hostile traffic
      // with error frames.
      if (!bucket.consume()) return;
      const raw = typeof data === "string" ? data : data.toString("utf8");
      // Fire and forget: dispatch routes the message onto its group's queue
      // synchronously (preserving arrival order) and resolves once handled.
      void dispatch(ctx, client, raw);
    });

    ws.on("close", () => {
      ipRegistry.release(ip);
      hub.remove(client);
      hub.broadcast({ t: "leave", userId: client.userId });
      void releaseHeldGroups(ctx, client.userId, hub);
    });
  });

  const shutdown = async () => {
    console.log("[shutdown] closing");
    snapshotPublisher.stop();
    wss.close();
    httpServer.close();
    await redis.quit();
    await mongo.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Release every group a departing client still held. The candidate scan runs
// unlocked, then the release runs on those groups' queues: no other client can
// take a hold this user already owns, and a hold cleared in the meantime (the
// group merged away or anchored) is re-checked under the lock before release,
// so the cleanup never fights a concurrent merge on those groups.
async function releaseHeldGroups(ctx: Context, userId: string, hub: Hub): Promise<void> {
  const groups = await ctx.state.readAllGroups(ctx.meta.totalPieces);
  const heldIds = groups.filter((g) => g.heldBy === userId).map((g) => g.id);
  if (heldIds.length === 0) return;
  await ctx.queue.run("release", heldIds, async () => {
    for (const id of heldIds) {
      const g = await ctx.state.readGroup(id);
      if (!g || g.heldBy !== userId) continue;
      await ctx.state.releaseGroup(id);
      hub.broadcastNear(
        { t: "drop", groupId: id, worldX: g.worldX, worldY: g.worldY, userId },
        g.worldX,
        g.worldY,
      );
    }
  });
}

main().catch((e: unknown) => {
  console.error("[fatal]", e);
  process.exit(1);
});
