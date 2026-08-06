// Puzzle-scoped wipe for ops use: resets one puzzle back to no-state (Redis
// piece/group/meta keys, the Mongo merge log, and any baked R2 cell
// composites) without touching other puzzles, accounts, or sessions. The
// standalone counterpart to lifecycle.ts's resetCurrent(), which only a
// running server with that puzzle already loaded in memory can call; this
// targets an arbitrary Redis/Mongo/R2 directly, so a lock-test scenario (see
// seed-lock-scenario.ts) can be re-seeded from scratch between runs without a
// full FLUSHDB (see admin.ts's /admin/clear, which also drops every other
// puzzle's data and every account and session).
//
// Requires the puzzle to already have meta (a previously-generated board) and
// an explicit --confirm WIPE, mirroring the admin page's own confirm text:
// refuses to run against a puzzle id Redis has never heard of (nothing to
// wipe, no totalPieces to iterate) or without the confirmation flag.
//
//   npm run wipe-puzzle -w @mpp/server -- \
//     --redis redis://127.0.0.1:6379 \
//     --mongo mongodb://127.0.0.1:27017 --mongo-db mpp \
//     --puzzle synthetic-1m --confirm WIPE

import { Redis as IORedis } from "ioredis";
import { MongoClient } from "mongodb";
import { RedisState } from "./state.js";
import { MongoLogger } from "./mongo.js";
import { loadConfig } from "./config.js";
import { createR2Client } from "./r2.js";

type Args = {
  redisUrl: string;
  mongoUrl: string;
  mongoDb: string;
  puzzleId: string;
  confirm: string | undefined;
};

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag || !flag.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) continue;
    args[flag.slice(2)] = next;
    i++;
  }
  const puzzleId = args["puzzle"];
  if (!puzzleId) throw new Error("missing --puzzle <puzzleId>");
  return {
    redisUrl: args["redis"] ?? "redis://127.0.0.1:6379",
    mongoUrl: args["mongo"] ?? "mongodb://127.0.0.1:27017",
    mongoDb: args["mongo-db"] ?? "mpp",
    puzzleId,
    confirm: args["confirm"],
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.confirm !== "WIPE") {
    throw new Error(
      `refusing to wipe "${args.puzzleId}" without --confirm WIPE: this permanently deletes ` +
        `the puzzle's Redis state, Mongo merge log, and any baked R2 cell composites.`,
    );
  }
  console.log(
    `[wipe-puzzle] puzzle=${args.puzzleId} redis=${args.redisUrl} mongo=${args.mongoUrl}/${args.mongoDb}`,
  );
  const redis = new IORedis(args.redisUrl, { maxRetriesPerRequest: null });
  const mongoClient = new MongoClient(args.mongoUrl);
  try {
    await mongoClient.connect();
    const state = new RedisState(redis, args.puzzleId);

    if (!(await state.hasMeta())) {
      throw new Error(`puzzle "${args.puzzleId}" has no state in this Redis: nothing to wipe.`);
    }
    const meta = await state.readMeta();

    const config = await loadConfig({ puzzleId: args.puzzleId });
    if (config.r2Write) {
      const r2 = createR2Client(config.r2Write);
      // Matches CellCompositor.clearAll's own prefix exactly (see
      // cellCompositor.ts): the whole <puzzleId>/cells/ tree, catching every
      // version any past life of this puzzle ever baked, not just the
      // (about-to-be-cleared) version index's last-known one.
      await r2.removeByPrefix(`${args.puzzleId}/cells/`);
    } else {
      console.warn(
        "[wipe-puzzle] MPP_R2_ENDPOINT/MPP_R2_ACCESS_KEY_ID/MPP_R2_SECRET_ACCESS_KEY unset: skipping R2 cell-composite cleanup.",
      );
    }

    await state.wipePuzzle(meta.totalPieces);
    await state.clearCellCompositeVersions();
    const mongo = new MongoLogger(mongoClient.db(args.mongoDb));
    await mongo.clearPuzzle(args.puzzleId);

    console.log(
      `[wipe-puzzle] wiped ${meta.totalPieces} pieces, cleared merge log and cell composites for "${args.puzzleId}"`,
    );
  } finally {
    redis.disconnect();
    await mongoClient.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
