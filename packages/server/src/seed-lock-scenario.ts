// Seeds a near-complete-board scenario for Phase 5 verification: marks
// ~995,000 of a fresh puzzle's pieces locked directly, bypassing cluster
// merging entirely (locked pieces are independent of groups since Stage 1/2,
// see DECISIONS: locked pieces stop being a group). Exercises a scale no
// gameplay session realistically reaches quickly: a board already
// near-solved, stressing the locked-piece delivery path (region_state's
// lockedPieceIds, LOD tile baking over locked regions) the 50-bot 1M soak
// never touched.
//
// Requires a fresh, unplayed puzzle: every chosen piece must still be its own
// singleton group (group.id === pieceId), so deleting "its own" group is
// exactly the one group it belongs to. This is DESTRUCTIVE and test-only:
// refuses to run against a puzzle id that already has state (a live or
// previously-played puzzle), never overwrites one. Target a dedicated /
// throwaway puzzle id and a Redis/Mongo you can afford to wipe. If the target
// has no meta yet, this inits it itself, using the same manifest/seed the
// real server would (MPP_ASSETS_BASE_URL / MPP_GENERATION_SEED / --puzzle).
//
// Must run before the server (re)starts, or against a stopped server: the
// running process's in-memory GroupIndex/MinimapGridTracker/LockedPieceIndex
// are boot-time snapshots of Redis with no mechanism to notice a direct
// external mutation.
//
//   npm run seed-lock-scenario -w @mpp/server -- \
//     --redis redis://127.0.0.1:6379 \
//     --mongo mongodb://127.0.0.1:27017 --mongo-db mpp \
//     --puzzle synthetic-1m-lock-test --locked-count 995000
//
// Then:
//   1. npm run validate-state -w @mpp/server -- --puzzle synthetic-1m-lock-test
//   2. start (or restart) the server against the same Redis/Mongo (boot rebuilds
//      the in-memory indexes from the seeded state)
//   3. connect a real browser client, pan across the board including
//      never-visited, ~100%-locked cells: watch for hang/crash, resident piece
//      count staying under the client's budget, LOD tiles baking correctly
//      over the locked regions
// validate-state alone is necessary but not sufficient: it proves Redis/Mongo
// consistency, not client-side rendering survival, which needs a real
// connect-and-pan.

import { Redis as IORedis } from "ioredis";
import { MongoClient } from "mongodb";
import { mulberry32, seedFromString, subseed } from "@mpp/shared";
import { loadConfig } from "./config.js";
import { RedisState } from "./state.js";
import { MongoLogger } from "./mongo.js";
import { forceInitPuzzle } from "./init.js";
import * as keys from "./redis/keys.js";

// Domain-separates this script's RNG stream from the generator's own (see
// init.ts's SCATTER_DOMAIN, generate.ts's HORIZONTAL_DOMAIN/VERTICAL_DOMAIN):
// distinct domains off the same generationSeed never correlate.
const LOCK_SCENARIO_DOMAIN = 3;
const DEFAULT_LOCKED_COUNT = 995000;
const CHUNK = 1000;
// Mongo's per-document BSON limit is 16 MB; a single cluster_merges doc carries
// two id arrays (droppedPieceIds, lockedPieceIds), so the safe id count per doc
// is roughly half that. 50,000 keeps every doc under ~1.2 MB, comfortably clear
// of both the hard limit and the BSON serializer's own buffer-growth edge cases
// observed failing already below the nominal 16 MB boundary.
const MERGE_LOG_CHUNK = 50000;

type Args = {
  redisUrl: string;
  mongoUrl: string;
  mongoDb: string;
  puzzleId: string;
  lockedCount: number;
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
  const lockedCount = args["locked-count"] ? Number(args["locked-count"]) : DEFAULT_LOCKED_COUNT;
  if (!Number.isFinite(lockedCount) || lockedCount < 0) {
    throw new Error(`--locked-count must be a non-negative number, got "${args["locked-count"]}"`);
  }
  return {
    redisUrl: args["redis"] ?? "redis://127.0.0.1:6379",
    mongoUrl: args["mongo"] ?? "mongodb://127.0.0.1:27017",
    mongoDb: args["mongo-db"] ?? "mpp",
    puzzleId,
    lockedCount,
  };
}

// Bernoulli-selects roughly lockedCount of [0, totalPieces) via a seeded RNG,
// deterministic per generationSeed (matching init.ts's domain-separated
// subseed convention, not Math.random()). Exactness to the piece doesn't
// matter, only the target fraction ("~995,000" per the ROADMAP wording); the
// remaining pieces stay in their natural scattered-singleton state, already
// the realistic end-game shape (unsolved pieces spread across the whole
// board, not clumped).
function pickLockedIds(totalPieces: number, lockedCount: number, generationSeed: string): number[] {
  const fraction = Math.min(1, lockedCount / totalPieces);
  const rng = mulberry32(subseed(seedFromString(generationSeed), LOCK_SCENARIO_DOMAIN, 0, 0));
  const chosen: number[] = [];
  for (let id = 0; id < totalPieces; id++) {
    if (rng() < fraction) chosen.push(id);
  }
  return chosen;
}

// Locks every chosen id directly and deletes its (still-singleton) group, in
// one chunked pipeline pass: the same coupling applyMerge's anchored branch
// and state.ts's anchorAllGroups both enforce (a locked piece must never
// leave a group behind), valid here specifically because a fresh puzzle's
// untouched pieces are each still their own singleton group.
async function lockPiecesDirectly(
  redis: IORedis,
  puzzleId: string,
  ids: readonly number[],
): Promise<void> {
  for (let start = 0; start < ids.length; start += CHUNK) {
    const slice = ids.slice(start, start + CHUNK);
    const pipe = redis.pipeline();
    for (const id of slice) {
      pipe.hset(keys.piece(puzzleId, id), "locked", 1);
      pipe.del(keys.group(puzzleId, id), keys.groupPieces(puzzleId, id));
    }
    await pipe.exec();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[seed-lock-scenario] puzzle=${args.puzzleId} lockedCount=${args.lockedCount} redis=${args.redisUrl} mongo=${args.mongoUrl}/${args.mongoDb}`,
  );
  const redis = new IORedis(args.redisUrl, { maxRetriesPerRequest: null });
  const mongoClient = new MongoClient(args.mongoUrl);
  try {
    await mongoClient.connect();
    const state = new RedisState(redis, args.puzzleId);

    if (await state.hasMeta()) {
      throw new Error(
        `puzzle "${args.puzzleId}" already has state in this Redis. This script only ` +
          `seeds a fresh, unplayed puzzle: point --puzzle at a dedicated/throwaway id, or ` +
          `wipe the existing state for this one first.`,
      );
    }
    const config = await loadConfig({ puzzleId: args.puzzleId });
    const meta = await forceInitPuzzle(state, config.manifest, config.generationSeed);

    const chosenIds = pickLockedIds(meta.totalPieces, args.lockedCount, meta.generationSeed);
    console.log(`[seed-lock-scenario] locking ${chosenIds.length} of ${meta.totalPieces} pieces`);

    await lockPiecesDirectly(redis, args.puzzleId, chosenIds);
    await state.addLockedCount(chosenIds.length);

    // Synthetic cluster_merges documents, modeled on lifecycle.ts's
    // forceComplete precedent for a direct, non-gameplay state change: without
    // them, validate-state's replay-based check would correctly fail (Redis
    // flagged these ids locked, but no merge log entry ever locked them).
    // Chunked (see MERGE_LOG_CHUNK): replayMerges only ever sums lockedDelta and
    // unions lockedPieceIds across the log, so N smaller docs replay identically
    // to one giant one, and stay clear of Mongo's 16 MB per-document BSON limit
    // that one document carrying all ~995,000 ids in two fields would hit.
    const mongo = new MongoLogger(mongoClient.db(args.mongoDb));
    const at = new Date();
    let logged = 0;
    for (let start = 0; start < chosenIds.length; start += MERGE_LOG_CHUNK) {
      const slice = chosenIds.slice(start, start + MERGE_LOG_CHUNK);
      await mongo.logMerge({
        puzzleId: args.puzzleId,
        userId: "seed-script",
        addedPieceIds: [],
        droppedPieceIds: slice,
        targetAnchorPieceId: slice[0] ?? 0,
        anchored: true,
        lockedDelta: slice.length,
        lockedPieceIds: slice,
        mergedSize: slice.length,
        at,
      });
      logged += slice.length;
    }

    console.log(
      `[seed-lock-scenario] done: ${chosenIds.length} pieces locked, ${Math.ceil(logged / MERGE_LOG_CHUNK)} synthetic cluster_merges docs logged`,
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
