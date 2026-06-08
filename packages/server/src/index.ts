import { createServer, type IncomingMessage } from "node:http";
import { Redis as IORedis } from "ioredis";
import { MongoClient } from "mongodb";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import { WebSocketServer, type WebSocket, type VerifyClientCallbackAsync } from "ws";
import { PROTOCOL_VERSION } from "@mpp/shared";
import { loadConfig } from "./config.js";
import { Hub, type Client } from "./hub.js";
import { worldAabbFor } from "./worldGrid.js";
import { RedisState } from "./state.js";
import { MongoLogger, ensureIndexes } from "./mongo.js";
import { dispatch, LEADERBOARD_LIMIT, type Context } from "./handlers.js";
import { GroupQueue } from "./queue.js";
import { ACTIVITY_BACKFILL_LIMIT, PuzzleLifecycle } from "./lifecycle.js";
import { initPuzzleIfEmpty, rebuildGroupIndex } from "./init.js";
import { GroupIndex } from "./groupIndex.js";
import { IpRegistry, isAllowedOrigin, clientIp, RedisFixedWindow } from "./limits.js";
import { KeyframePublisher, makeKeyframeHandler, makeEventsHandler } from "./keyframe.js";
import { EventLog } from "./eventLog.js";
import { buildAuthConfig, resolveSessionUser } from "./auth.js";
import { createApp } from "./httpApp.js";
import { RedisInterested } from "./interested.js";

// WebSocket close code 1013 ("Try Again Later"), used to refuse a connection
// that exceeds the per-IP concurrent-connection cap.
const CLOSE_TRY_AGAIN_LATER = 1013;

// User stashed on the upgrade request by verifyClient and read by the
// connection handler, so the session is resolved exactly once at the upgrade.
type AuthedUser = { id: string; pseudo: string | null };
type AuthedRequest = IncomingMessage & { mppUser?: AuthedUser };

async function main(): Promise<void> {
  const config = await loadConfig();

  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  redis.on("error", (e: Error) => console.error("[redis]", e.message));

  // One Mongo client shared by the merge log, the user-profile ops, and the
  // Auth.js adapter.
  const mongoClient = new MongoClient(config.mongoUrl);
  await mongoClient.connect();
  const db = mongoClient.db(config.mongoDb);
  await ensureIndexes(db);
  const mongo = new MongoLogger(db);
  const adapter = MongoDBAdapter(mongoClient, { databaseName: config.mongoDb });

  const manifest = config.manifest;
  const state = new RedisState(redis, manifest.puzzleId);
  const eventLog = new EventLog(redis, manifest.puzzleId);
  const meta = await initPuzzleIfEmpty(state, manifest);

  // Scoped broadcasts are routed through a spatial index whose world grid cell is
  // sized from the puzzle's pieceSize (see DECISIONS: spatial broadcast index).
  const cellSize = meta.pieceSize * config.broadcastCellPieces;
  const hub = new Hub(config.wsBufferedAmountLimitBytes, cellSize, config.broadcastMaxCells);
  // Group position read model on the same cell grid, rebuilt from Redis at boot
  // (and on reset). Drives the pan resync (see DECISIONS: group index + resync).
  const groupIndex = new GroupIndex(cellSize);
  await rebuildGroupIndex(groupIndex, state, meta.totalPieces);
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
    eventLog,
    devEnabled: config.devEnabled,
    eventStartsAt: config.eventStartsAt,
    queue,
    groupIndex,
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

  // Auth.js reads its secrets and host from process.env; fill non-secret dev
  // defaults so a local run works, and warn loudly when the secrets are missing.
  process.env.AUTH_URL ??= config.authUrl;
  process.env.AUTH_TRUST_HOST ??= "true";
  if (!process.env.AUTH_SECRET) {
    console.warn("[auth] AUTH_SECRET is unset: auth routes and WS upgrades will fail.");
  }
  if (!process.env.AUTH_GOOGLE_ID || !process.env.AUTH_GOOGLE_SECRET) {
    console.warn("[auth] AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET unset: Google sign-in will fail.");
  }
  const authConfig = buildAuthConfig({
    adapter,
    secure: config.authSecure,
    cookieDomain: config.authCookieDomain,
    appOrigin: config.appOrigin,
  });

  // Spectator stream: a keyframe (full state, regenerated only while the event is
  // live) plus an ordered event log of drops and snaps addressed as immutable
  // wall-clock windows. The publisher keeps the latest keyframe body in memory;
  // the HTTP handlers serve it and the sealed windows without re-querying Redis on
  // a keyframe hit. Both endpoints are CDN-fronted (see DECISIONS).
  const keyframePublisher = new KeyframePublisher(config.keyframeIntervalMs, {
    state,
    eventLog,
    puzzleId: () => ctx.puzzleId,
    totalPieces: () => ctx.meta.totalPieces,
    gridCols: () => ctx.meta.gridCols,
    pieceSize: () => ctx.meta.pieceSize,
    playZone: () => lifecycle.currentPlayZone(),
    eventStartsAt: () => ctx.eventStartsAt,
    status: () => ctx.meta.status,
    leaderboard: () => mongo.leaderboard(ctx.puzzleId, LEADERBOARD_LIMIT),
    activity: () => mongo.recentAnchoredMerges(ctx.puzzleId, ACTIVITY_BACKFILL_LIMIT),
    windowMs: config.eventWindowMs,
    delayMs: config.interpDelayMs,
  });
  // Broadcast the minimap grid to contributors after each keyframe regenerate
  // (periodic while live, forced on reset/complete), so the contributor minimap
  // refreshes on the keyframe cadence without a second full-board read. The grid
  // is also sent once per contributor on join (see lifecycle.sendWelcome).
  keyframePublisher.onRegenerated = (kf) => hub.broadcast({ t: "minimap", grid: kf.minimapGrid });
  lifecycle.attachKeyframePublisher(keyframePublisher);
  keyframePublisher.start();
  const handleKeyframe = makeKeyframeHandler(keyframePublisher, {
    intervalMs: config.keyframeIntervalMs,
    idleTtlMs: config.keyframeIdleTtlMs,
  });
  const handleEvents = makeEventsHandler({
    eventLog,
    windowMs: config.eventWindowMs,
    retentionMs: config.eventRetentionMs,
  });

  // Trim the event log to its retention horizon on the keyframe cadence. Only the
  // live event adds entries, so trimming at the (slow) keyframe interval keeps the
  // stream bounded without a dedicated fast timer.
  const trimTimer = setInterval(() => {
    void eventLog.trim(config.eventRetentionMs).catch((e: unknown) => {
      console.error("[events] trim failed:", (e as Error).message);
    });
  }, config.keyframeIntervalMs);

  // Express hosts the auth routes, the pseudo-profile route, and the spectator
  // stream. The WebSocket upgrade attaches to the same http.Server below.
  const app = createApp({
    authConfig,
    pseudoStore: mongo,
    countryStore: mongo,
    authLimiter: new RedisFixedWindow(redis, "auth", config.authRateMax, config.authRateWindowSec),
    signupLimiter: new RedisFixedWindow(
      redis,
      "signup",
      config.signupMaxPerIp,
      config.signupWindowSec,
    ),
    spectatorLimiter: new RedisFixedWindow(
      redis,
      "spectator",
      config.spectatorRateMax,
      config.spectatorRateWindowSec,
    ),
    // The interested-IP hash is keyed by AUTH_SECRET (already a per-deployment
    // secret in process.env, kept out of config). Dev runs without it fall back to
    // a fixed salt so the dedup stays stable across restarts locally.
    interested: new RedisInterested(
      redis,
      manifest.puzzleId,
      process.env.AUTH_SECRET || "mpp-interested-dev-salt",
    ),
    eventStartsAt: config.eventStartsAt,
    appOrigin: config.appOrigin,
    devEnabled: config.devEnabled,
    handleKeyframe,
    handleEvents,
  });
  const httpServer = createServer(app);

  // The WS upgrade requires a valid session: the Origin is checked, then the
  // parent-domain session cookie is resolved against the adapter. Resolving here
  // (not in the connection handler) means the connection only fires for an
  // authenticated upgrade, so no early `hello` is dropped during the async
  // lookup. The resolved user is stashed on the request for the handler.
  const verifyClient: VerifyClientCallbackAsync = (info, cb) => {
    if (!isAllowedOrigin(info.origin, config.allowedOrigins)) {
      cb(false, 403, "forbidden origin");
      return;
    }
    void (async () => {
      try {
        const resolved = await resolveSessionUser(
          info.req.headers.cookie,
          adapter,
          config.authSecure,
        );
        if (!resolved) {
          cb(false, 401, "unauthorized");
          return;
        }
        (info.req as AuthedRequest).mppUser = {
          id: resolved.user.id,
          pseudo: (resolved.user as { pseudo?: string | null }).pseudo ?? null,
        };
        cb(true);
      } catch (e) {
        console.error("[ws auth]", (e as Error).message);
        cb(false, 401, "unauthorized");
      }
    })();
  };
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: config.wsMaxPayloadBytes,
    verifyClient,
  });
  httpServer.listen(config.port, () => {
    console.log(
      `[http] listening on ${config.port} (ws upgrade + /auth + /profile + GET /keyframe + GET /events/<t0>, keyframe interval ${config.keyframeIntervalMs}ms, window ${config.eventWindowMs}ms, delay ${config.interpDelayMs}ms)`,
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
    const authed = (request as AuthedRequest).mppUser;
    if (!authed) {
      // verifyClient only lets authenticated upgrades through, so this is a
      // defensive guard rather than an expected path.
      ws.close(1011, "auth missing");
      return;
    }
    const ip = clientIp(request, config.devEnabled);
    const bucket = ipRegistry.acquire(ip);
    if (bucket === null) {
      // Over the per-IP concurrent-connection cap: refuse before adding the
      // client so one IP cannot hold more than its budget of sessions open.
      ws.close(CLOSE_TRY_AGAIN_LATER, "too many connections");
      return;
    }
    const client: Client = {
      userId: authed.id,
      ws,
      bucket,
      viewport: null,
      pseudo: authed.pseudo,
      held: new Set(),
      cells: new Set(),
      alive: true,
    };
    ws.on("pong", () => {
      client.alive = true;
    });
    void mongo.touchLastSeen(authed.id).catch((e: unknown) => {
      console.error("[lastSeen]", (e as Error).message);
    });
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
      void releaseHeldGroups(ctx, client, hub);
    });
  });

  // Keep connections warm through the Cloudflare proxy (which drops a WS idle for
  // ~100s) and reap half-open sockets: a client that did not pong since the last
  // tick is terminated, which fires `close` and the normal cleanup above.
  const heartbeatTimer = setInterval(() => {
    for (const c of hub.allClients()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        c.ws.terminate();
      }
    }
  }, config.wsHeartbeatIntervalMs);

  const shutdown = async () => {
    console.log("[shutdown] closing");
    keyframePublisher.stop();
    clearInterval(trimTimer);
    clearInterval(heartbeatTimer);
    wss.close();
    httpServer.close();
    await redis.quit();
    await mongoClient.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Release every group a departing client still held. The connection tracks its
// held group ids (see Client.held), so the cleanup is O(held), not a board scan,
// and a client that never grabbed anything does nothing. The release runs on
// those groups' queues: no other client can take a hold this user already owns,
// and a stale id (the group merged away or anchored between the drop and the
// disconnect) is re-checked under the lock before release, so the cleanup never
// fights a concurrent merge on those groups.
async function releaseHeldGroups(ctx: Context, client: Client, hub: Hub): Promise<void> {
  const heldIds = [...client.held];
  if (heldIds.length === 0) return;
  const userId = client.userId;
  await ctx.queue.run("release", heldIds, async () => {
    for (const id of heldIds) {
      const g = await ctx.state.readGroup(id);
      if (!g || g.heldBy !== userId) continue;
      await ctx.state.releaseGroup(id);
      hub.broadcastOverlapping(
        { t: "drop", groupId: id, worldX: g.worldX, worldY: g.worldY, userId },
        worldAabbFor(g.localAabb, g.worldX, g.worldY),
      );
      // The disconnect-drop is a real position change, so it joins the spectator
      // event log like a normal non-merging drop.
      await ctx.eventLog.recordDrop({ groupId: id, worldX: g.worldX, worldY: g.worldY });
    }
  });
}

main().catch((e: unknown) => {
  console.error("[fatal]", e);
  process.exit(1);
});
