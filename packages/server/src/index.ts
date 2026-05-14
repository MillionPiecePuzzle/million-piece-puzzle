import { randomUUID } from "node:crypto";
import { Redis as IORedis } from "ioredis";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION } from "@mpp/shared";
import { loadConfig } from "./config.js";
import { Hub, type Client } from "./hub.js";
import { initPuzzleIfEmpty } from "./init.js";
import { RedisState } from "./state.js";
import { MongoLogger } from "./mongo.js";
import { dispatch, type Context } from "./handlers.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const puzzleId = config.manifest.puzzleId;

  const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  redis.on("error", (e: Error) => console.error("[redis]", e.message));

  const mongo = new MongoLogger(config.mongoUrl, config.mongoDb);
  await mongo.connect();

  const state = new RedisState(redis, puzzleId);
  const meta = await initPuzzleIfEmpty(state, config.manifest);
  console.log(
    `[boot] puzzle=${puzzleId} pieces=${meta.totalPieces} (${meta.gridCols}x${meta.gridRows}) protocol=v${PROTOCOL_VERSION}`,
  );

  const hub = new Hub();
  const ctx: Context = {
    hub,
    state,
    meta,
    puzzleId,
    mongo,
  };

  const wss = new WebSocketServer({ port: config.port });
  wss.on("listening", () => {
    console.log(`[ws] listening on ${config.port}`);
  });

  // Global dispatch queue: every message runs to completion before the next
  // starts, so handler `await` points cannot interleave across clients.
  let dispatchChain: Promise<void> = Promise.resolve();

  wss.on("connection", (ws: WebSocket) => {
    const client: Client = { userId: randomUUID(), ws };
    hub.add(client);

    ws.on("message", (data) => {
      const raw = typeof data === "string" ? data : data.toString("utf8");
      dispatchChain = dispatchChain.then(() =>
        dispatch(ctx, client, raw).catch((e: unknown) => {
          console.error("[dispatch]", e);
        }),
      );
    });

    ws.on("close", () => {
      hub.remove(client);
      releaseHeldGroups(state, meta.totalPieces, client.userId, hub).catch((e: unknown) =>
        console.error("[release]", e),
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
      hub.broadcast({
        t: "drop",
        groupId: g.id,
        worldX: g.worldX,
        worldY: g.worldY,
        userId,
      });
    }
  }
}

main().catch((e: unknown) => {
  console.error("[fatal]", e);
  process.exit(1);
});
