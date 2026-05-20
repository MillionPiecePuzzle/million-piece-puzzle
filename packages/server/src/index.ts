import { randomUUID } from "node:crypto";
import { Redis as IORedis } from "ioredis";
import { WebSocketServer, type WebSocket, type VerifyClientCallbackSync } from "ws";
import { PROTOCOL_VERSION } from "@mpp/shared";
import { loadConfig } from "./config.js";
import { Hub, type Client } from "./hub.js";
import { RedisState } from "./state.js";
import { MongoLogger } from "./mongo.js";
import { dispatch, type Context } from "./handlers.js";
import { SerialQueue } from "./queue.js";
import { PuzzleCycle } from "./cycle.js";
import { TokenBucket, isAllowedOrigin } from "./limits.js";

async function main(): Promise<void> {
  const config = await loadConfig();

  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  redis.on("error", (e: Error) => console.error("[redis]", e.message));

  const mongo = new MongoLogger(config.mongoUrl, config.mongoDb);
  await mongo.connect();

  // Bootstrap state with the first manifest. PuzzleCycle then takes over and
  // restores whatever puzzle was active when the server was last running.
  const firstManifest = config.manifests[0];
  if (!firstManifest) throw new Error("config.manifests is empty");
  const state = new RedisState(redis, firstManifest.puzzleId);

  const hub = new Hub(config.wsBufferedAmountLimitBytes);
  const ctx: Context = {
    hub,
    state,
    meta: {
      totalPieces: 0,
      gridRows: 0,
      gridCols: 0,
      pieceSize: 0,
      snapTolerance: 0,
      generationSeed: "",
      status: "active",
      startedAt: 0,
    },
    puzzleId: firstManifest.puzzleId,
    mongo,
    devEnabled: config.devEnabled,
  };
  const cycle = new PuzzleCycle(ctx, config.manifests, config.cycleDelayMs);
  ctx.cycle = cycle;
  await cycle.restoreOrPickFirst();

  console.log(
    `[boot] puzzles=${config.manifests.map((m) => m.puzzleId).join(",")} active=${ctx.puzzleId} pieces=${ctx.meta.totalPieces} (${ctx.meta.gridCols}x${ctx.meta.gridRows}) protocol=v${PROTOCOL_VERSION} dev=${config.devEnabled}`,
  );

  if (config.allowedOrigins.length === 1 && config.allowedOrigins[0] === "*") {
    console.warn(
      "[ws] MPP_ALLOWED_ORIGINS unset, accepting any Origin. Set it to your frontend origin(s) for production.",
    );
  }

  const verifyClient: VerifyClientCallbackSync = (info) =>
    isAllowedOrigin(info.origin, config.allowedOrigins);
  const wss = new WebSocketServer({
    port: config.port,
    maxPayload: config.wsMaxPayloadBytes,
    verifyClient,
  });
  wss.on("listening", () => {
    console.log(`[ws] listening on ${config.port}`);
  });

  // Every message and disconnect cleanup runs through one queue, so handlers'
  // `await` points cannot interleave (see DECISIONS: global serial dispatch queue).
  const queue = new SerialQueue();

  wss.on("connection", (ws: WebSocket) => {
    const bucket = new TokenBucket(config.wsRateBurst, config.wsRateTokensPerSec);
    const client: Client = { userId: randomUUID(), ws, bucket, viewport: null, pseudo: null };
    // Presence: tell the newcomer about peers already present, then announce
    // the newcomer to them. join and leave bracket a connection.
    for (const peer of hub.allClients()) {
      hub.send(client, { t: "join", userId: peer.userId, pseudo: peer.pseudo });
    }
    hub.add(client);
    hub.broadcast({ t: "join", userId: client.userId, pseudo: client.pseudo }, client);

    ws.on("message", (data) => {
      // Hostile clients that exceed the per-connection rate are dropped
      // silently to avoid amplifying their traffic with error frames.
      if (!bucket.consume()) return;
      const raw = typeof data === "string" ? data : data.toString("utf8");
      queue.enqueue("dispatch", () => dispatch(ctx, client, raw));
    });

    ws.on("close", () => {
      hub.remove(client);
      hub.broadcast({ t: "leave", userId: client.userId });
      queue.enqueue("release", () =>
        releaseHeldGroups(ctx.state, ctx.meta.totalPieces, client.userId, hub),
      );
    });
  });

  const shutdown = async () => {
    console.log("[shutdown] closing");
    wss.close();
    await redis.quit();
    await mongo.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function releaseHeldGroups(
  state: RedisState,
  totalPieces: number,
  userId: string,
  hub: Hub,
): Promise<void> {
  const groups = await state.readAllGroups(totalPieces);
  for (const g of groups) {
    if (g.heldBy === userId) {
      await state.releaseGroup(g.id);
      hub.broadcastNear(
        {
          t: "drop",
          groupId: g.id,
          worldX: g.worldX,
          worldY: g.worldY,
          userId,
        },
        g.worldX,
        g.worldY,
      );
    }
  }
}

main().catch((e: unknown) => {
  console.error("[fatal]", e);
  process.exit(1);
});
