import { createServer, type IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { Redis as IORedis } from "ioredis";
import { MongoClient } from "mongodb";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import { WebSocketServer, type WebSocket, type VerifyClientCallbackAsync } from "ws";
import { PROTOCOL_VERSION, WORLD_TILE_SIZE } from "@mpp/shared";
import { loadConfig, DEFAULT_REDIS_URL } from "./config.js";
import { readAdminOverrides, UnknownPuzzleError } from "./admin.js";
import { adminEventStart, adminPuzzleOverride } from "./redis/keys.js";
import { Hub, type Client } from "./hub.js";
import { buildWireContext } from "./wire.js";
import { RedisState } from "./state.js";
import { MongoLogger, ensureIndexes } from "./mongo.js";
import { dispatch, LEADERBOARD_LIMIT, type Context } from "./handlers.js";
import { GroupQueue } from "./queue.js";
import { releaseHeldGroups, sweepStaleHolds } from "./holds.js";
import { ACTIVITY_BACKFILL_LIMIT, PuzzleLifecycle } from "./lifecycle.js";
import { initPuzzleIfEmpty, rebuildGroupIndex } from "./init.js";
import { GroupIndex } from "./groupIndex.js";
import { IpRegistry, isAllowedOrigin, clientIp, RedisFixedWindow } from "./limits.js";
import { AdmissionController } from "./admission.js";
import { KeyframePublisher } from "./keyframe.js";
import {
  buildAuthConfig,
  resolveSessionUser,
  sessionCookieName,
  GUEST_SESSION_MAX_AGE_MS,
} from "./auth.js";
import { createApp } from "./httpApp.js";
import { RedisInterested } from "./interested.js";

// WebSocket close code 1013 ("Try Again Later"), used to refuse a connection
// that exceeds the per-IP concurrent-connection cap or presents no valid
// admission grant.
const CLOSE_TRY_AGAIN_LATER = 1013;

// Cadence of the admission-queue sweep: reclaim expired grants and abandoned
// waiters, then admit into the freed slots even when no one is polling.
const ADMISSION_SWEEP_INTERVAL_MS = 5000;

// Cadence of the stale-hold sweep (see DECISIONS: grab reservation + stale-hold
// sweep). Independent of config.staleHoldMs (the age threshold): this is how
// often the (normally empty) candidate list is checked.
const STALE_HOLD_SWEEP_INTERVAL_MS = 30000;

// User stashed on the upgrade request by verifyClient and read by the
// connection handler, so the session is resolved exactly once at the upgrade.
type AuthedUser = { id: string; pseudo: string | null };
type AuthedRequest = IncomingMessage & { mppUser?: AuthedUser };

async function main(): Promise<void> {
  // The Redis client comes up before the config so a persisted admin override
  // (puzzle switch / event start) can supersede the env before loadConfig builds
  // everything that descends from the puzzle id and seed.
  const redisUrl = process.env.MPP_REDIS_URL ?? DEFAULT_REDIS_URL;
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  redis.on("error", (e: Error) => console.error("[redis]", e.message));
  const overrides = await readAdminOverrides(redis);
  const config = await loadConfig(overrides);

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
  const meta = await initPuzzleIfEmpty(state, manifest, config.generationSeed);

  // The wire boundary: the seed permutation (gridId <-> wireId) plus the grid
  // metrics the anchor/offset encoding needs. Built once at boot from the
  // server-only generation seed; both arrays are ~8 MB of process memory at 1M.
  const wire = buildWireContext(
    config.generationSeed,
    meta.totalPieces,
    meta.gridCols,
    meta.pieceSize,
  );

  // Scoped broadcasts are routed through a spatial index over the shared world
  // grid cell, the same cell the frontend bakes LOD tiles on and the piece cap
  // counts over (see DECISIONS: spatial broadcast index).
  const cellSize = WORLD_TILE_SIZE;
  const hub = new Hub(config.wsBufferedAmountLimitBytes, cellSize, config.broadcastMaxCells);
  // Group position read model on the same cell grid, rebuilt from Redis at boot
  // (and on reset). Drives the pan resync (see DECISIONS: group index + resync).
  const groupIndex = new GroupIndex(cellSize);
  await rebuildGroupIndex(groupIndex, state, meta.totalPieces);
  // Per-tile piece cap = the cell's solved density (how many pieces fill one cell
  // when solved, (cellSize / pieceSize) squared) times the configured multiple, so
  // the cap scales with the cell. An absolute MPP_TILE_PIECE_CAP overrides it when
  // set (testing/ops escape hatch).
  const solvedDensity = Math.round((cellSize / meta.pieceSize) ** 2);
  const tilePieceCap =
    config.tilePieceCapAbsolute > 0
      ? config.tilePieceCapAbsolute
      : solvedDensity * config.tilePieceCapMultiplier;
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
    eventStartsAt: config.eventStartsAt,
    generationSeed: config.generationSeed,
    queue,
    wire,
    groupIndex,
    tilePieceCap,
    broadcastMaxCells: config.broadcastMaxCells,
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

  // Mint a guest's DB session through the same adapter the WS gate resolves, so a
  // guest cookie is accepted identically to a Google one. The token is a random
  // UUID in the Auth.js database-session shape; createSession stores it.
  const guestSessionMinter = {
    async mint(userId: string): Promise<{ token: string; expires: Date }> {
      if (!adapter.createSession) throw new Error("auth adapter has no createSession");
      const token = randomUUID();
      const expires = new Date(Date.now() + GUEST_SESSION_MAX_AGE_MS);
      await adapter.createSession({ sessionToken: token, userId, expires });
      return { token, expires };
    },
  };

  // In-memory board snapshot (minimap grid + landing figures), regenerated only
  // while the event is live and frozen otherwise. It feeds the periodic minimap
  // broadcast to contributors and the public landing snapshot; no full board is
  // retained between regenerations.
  const keyframePublisher = new KeyframePublisher(config.keyframeIntervalMs, {
    state,
    totalPieces: () => ctx.meta.totalPieces,
    gridCols: () => ctx.meta.gridCols,
    pieceSize: () => ctx.meta.pieceSize,
    playZone: () => lifecycle.currentPlayZone(),
    eventStartsAt: () => ctx.eventStartsAt,
    status: () => ctx.meta.status,
    leaderboard: () => mongo.leaderboard(ctx.puzzleId, LEADERBOARD_LIMIT),
    activity: () => mongo.recentMerges(ctx.puzzleId, ACTIVITY_BACKFILL_LIMIT),
  });
  // Broadcast the minimap grid to contributors after each regenerate (periodic
  // while live, forced on reset/complete), so the contributor minimap refreshes on
  // the snapshot cadence without a second full-board read. The grid is also sent
  // once per contributor on join (see lifecycle.sendWelcome).
  keyframePublisher.onRegenerated = (snap) =>
    hub.broadcast({ t: "minimap", grid: snap.minimapGrid });
  lifecycle.attachKeyframePublisher(keyframePublisher);
  keyframePublisher.start();

  // Admin puzzle switch: the configured list plus the currently-running puzzle
  // (always selectable so a switch can be reverted), each mapped to its seed. The
  // seed never leaves the server; only id/label reach the browser.
  const adminPuzzleSeeds = new Map<string, string>();
  const adminPuzzleLabels = new Map<string, string>();
  for (const p of config.adminPuzzles) {
    adminPuzzleSeeds.set(p.id, p.seed);
    adminPuzzleLabels.set(p.id, p.label);
  }
  if (!adminPuzzleSeeds.has(config.puzzleId)) {
    adminPuzzleSeeds.set(config.puzzleId, config.generationSeed);
  }
  const adminDeps = config.adminPassword
    ? {
        password: config.adminPassword,
        puzzles: () =>
          [...adminPuzzleSeeds.keys()].map((id) => ({
            id,
            label: adminPuzzleLabels.get(id) ?? id,
            current: id === ctx.puzzleId,
          })),
        getEventStartsAt: () => ctx.eventStartsAt,
        setEventStartsAt: async (at: number) => {
          await redis.set(adminEventStart(), String(at));
          ctx.eventStartsAt = at;
          // Push the new start into the frozen board snapshot immediately
          // rather than waiting for the next periodic regenerate.
          await keyframePublisher.regenerate(true);
        },
        switchPuzzle: async (puzzleId: string) => {
          const seed = adminPuzzleSeeds.get(puzzleId);
          if (!seed) throw new UnknownPuzzleError(puzzleId);
          await redis.set(adminPuzzleOverride(), JSON.stringify({ puzzleId, seed }));
        },
        clearEverything: async () => {
          await redis.flushdb();
          await mongoClient.db(config.mongoDb).dropDatabase();
        },
        exit: () => process.exit(0),
      }
    : undefined;

  // Admission queue: a global cap on concurrent WS connections with a FIFO wait
  // list (see DECISIONS: admission queue). In-process like the Hub and IpRegistry,
  // since one process owns every connection. Disabled (cap 0) leaves the upgrade
  // grant-free, so the feature is opt-in per deployment.
  const admission = new AdmissionController({
    cap: config.maxActiveConnections,
    grantTtlMs: config.queueGrantTtlMs,
    ticketTtlMs: config.queueTicketTtlMs,
    maxQueueLength: config.maxQueueLength,
  });
  if (admission.enabled) {
    console.log(
      `[admission] cap=${config.maxActiveConnections} grantTtl=${config.queueGrantTtlMs}ms maxQueue=${config.maxQueueLength}`,
    );
  }

  // Express hosts the auth routes, the pseudo-profile route, the public
  // landing and queue endpoints, and (when a password is set) the admin page.
  // The WebSocket upgrade attaches to the same http.Server below.
  const app = createApp({
    authConfig,
    pseudoStore: mongo,
    countryStore: mongo,
    guestStore: mongo,
    claimStore: mongo,
    guestSessionMinter,
    authCookieName: sessionCookieName(config.authSecure),
    authSecure: config.authSecure,
    authCookieDomain: config.authCookieDomain,
    authLimiter: new RedisFixedWindow(redis, "auth", config.authRateMax, config.authRateWindowSec),
    signupLimiter: new RedisFixedWindow(
      redis,
      "signup",
      config.signupMaxPerIp,
      config.signupWindowSec,
    ),
    publicLimiter: new RedisFixedWindow(
      redis,
      "public",
      config.publicRateMax,
      config.publicRateWindowSec,
    ),
    queueLimiter: new RedisFixedWindow(
      redis,
      "queue",
      config.queueRateMax,
      config.queueRateWindowSec,
    ),
    admission,
    // The interested-IP hash is keyed by AUTH_SECRET (already a per-deployment
    // secret in process.env, kept out of config). Dev runs without it fall back to
    // a fixed salt so the dedup stays stable across restarts locally.
    interested: new RedisInterested(
      redis,
      manifest.puzzleId,
      process.env.AUTH_SECRET || "mpp-interested-dev-salt",
    ),
    eventStartsAt: () => ctx.eventStartsAt,
    // The landing's live progress/standings come from the in-memory keyframe
    // snapshot (rebuilt on the keyframe cadence, forced on complete), so the
    // public landing never triggers a full-board read.
    landingSnapshot: () => {
      const snap = keyframePublisher.latest();
      if (!snap) return null;
      return {
        lockedCount: snap.lockedCount,
        totalPieces: snap.totalPieces,
        leaderboard: snap.leaderboard,
        activity: snap.activity,
      };
    },
    puzzleStatus: () => ctx.meta.status,
    puzzleSpan: () => mongo.puzzleSpan(ctx.puzzleId),
    appOrigin: config.appOrigin,
    devEnabled: config.devEnabled,
    admin: adminDeps,
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
    // Admission gate: reject an upgrade with no valid grant before the (async)
    // session lookup, so a flood of grant-less upgrades costs nothing. The grant
    // is consumed (single-use) in the connection handler, not here. No-op when the
    // queue is disabled.
    if (admission.enabled && !admission.peekGrant(grantFromUpgrade(info.req))) {
      cb(false, 403, "queue grant required");
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
      `[http] listening on ${config.port} (ws upgrade + /auth + /profile + /landing, snapshot interval ${config.keyframeIntervalMs}ms)`,
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
    // Consume the admission grant atomically (single-use): the reserved slot
    // becomes this live connection, released on close below. A grant that expired
    // between the upgrade peek and here, or a token already redeemed by another
    // socket, is refused. No-op (always admitted) when the queue is disabled.
    const admitted = admission.enabled ? admission.redeem(grantFromUpgrade(request)) : true;
    if (!admitted) {
      ws.close(CLOSE_TRY_AGAIN_LATER, "queue grant invalid");
      return;
    }
    const ip = clientIp(request, config.devEnabled);
    const bucket = ipRegistry.acquire(ip);
    if (bucket === null) {
      // Over the per-IP concurrent-connection cap: refuse before adding the
      // client so one IP cannot hold more than its budget of sessions open. The
      // admission slot just consumed is returned so the refusal frees it.
      if (admission.enabled) admission.releaseConnection();
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
      // Return the admission slot and admit the next waiter into it.
      if (admission.enabled) admission.releaseConnection();
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

  // Periodic admission sweep: free stalled grants and abandoned waiters, then
  // admit into the freed slots. Only armed when the queue is enabled.
  const admissionSweepTimer = admission.enabled
    ? setInterval(() => admission.sweep(), ADMISSION_SWEEP_INTERVAL_MS)
    : null;

  // Periodic stale-hold sweep: always armed, independent of the admission queue.
  // Reclaims a hold whose owner is gone for any reason the in-process release
  // path missed (see DECISIONS: grab reservation + stale-hold sweep).
  const staleHoldSweepTimer = setInterval(() => {
    void sweepStaleHolds(ctx, hub, config.staleHoldMs).catch((e: unknown) => {
      console.error("[stale-hold]", (e as Error).message);
    });
  }, STALE_HOLD_SWEEP_INTERVAL_MS);

  const shutdown = async () => {
    console.log("[shutdown] closing");
    keyframePublisher.stop();
    clearInterval(heartbeatTimer);
    if (admissionSweepTimer) clearInterval(admissionSweepTimer);
    clearInterval(staleHoldSweepTimer);
    wss.close();
    httpServer.close();
    await redis.quit();
    await mongoClient.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Pull the admission grant token from the WS upgrade request's query string
// (`?grant=`). Returns null when absent or unparseable, which the admission gate
// treats as an invalid grant.
function grantFromUpgrade(req: IncomingMessage): string | null {
  try {
    return new URL(req.url ?? "/", "http://localhost").searchParams.get("grant");
  } catch {
    return null;
  }
}

main().catch((e: unknown) => {
  console.error("[fatal]", e);
  process.exit(1);
});
