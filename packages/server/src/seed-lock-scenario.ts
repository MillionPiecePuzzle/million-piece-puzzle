// Seeds a near-complete-board scenario for Phase 5 verification: locks a
// configurable subset of a fresh puzzle's pieces through the real gameplay
// path (grab, then a drop that lands exactly on the piece's own solved
// position) instead of writing `locked` flags into Redis directly. Every
// lock this script produces goes through the same handleGrab/handleDrop/
// applyMerge code a real client's drop does: real Redis reads/writes, real
// minimap and group-index maintenance, and a real cluster_merges log entry
// per lock.
//
// Compositing is deliberately NOT wired in during the locking loop (unlike
// live play, where each lock fires its own markDirty): CellCompositor.drain
// processes dirty cells strictly one at a time with no coalescing once a
// cell finishes baking (see cellCompositor.ts), so firing markDirty per lock
// at bulk-seed scale rebakes the same ~1,296 cells from scratch many times
// over instead of once. Instead, the compositor is attached only after every
// piece has locked, then every touched cell is marked dirty in one pass and
// drained once, with a small bounded retry (re-mark whatever still has no
// composite) to cover a transient fetch/upload failure that would otherwise
// have self-healed off a later lock event landing in the same cell (see
// processCell's own catch in cellCompositor.ts). This only changes when
// compositing happens, not the lock events themselves, which stay 100% real;
// it is a property of this bulk-seeding script, not of live play.
//
// Each chosen piece is its own singleton group (a fresh, unplayed puzzle), so
// dropping it at internal origin (0, 0) is exactly handleDrop's frameAnchor
// path (see handlers.ts): a piece's local AABB already bakes in its solved
// grid cell (col * pieceSize, row * pieceSize, see worldGrid.ts), and origin
// is a pure translation on top of that, so (0, 0) is what places the piece at
// its own solved position, not the piece's canonical world coordinates
// themselves (those would double the offset and land the drop away from the
// frame origin, never anchoring). This keeps the scenario simple while still
// exercising 100% real backend logic; it does not simulate a player growing a
// cluster through several loose-loose merges before dragging it to the frame.
//
//   npm run seed-lock-scenario -w @mpp/server -- \
//     --redis redis://127.0.0.1:6379 \
//     --mongo mongodb://127.0.0.1:27017 --mongo-db mpp \
//     --puzzle synthetic-1m-lock-test --locked-count 10000
//
// Requires a fresh, unplayed puzzle: every chosen piece must still be its own
// singleton group. This is DESTRUCTIVE and test-only: refuses to run against
// a puzzle id that already has state (a live or previously-played puzzle),
// never overwrites one. Target a dedicated / throwaway puzzle id and a
// Redis/Mongo you can afford to wipe. If the target has no meta yet, this
// inits it itself, using the same manifest/seed the real server would
// (MPP_ASSETS_BASE_URL / MPP_GENERATION_SEED / --puzzle). Also needs the same
// R2 write credentials (MPP_R2_ENDPOINT/MPP_R2_ACCESS_KEY_ID/
// MPP_R2_SECRET_ACCESS_KEY) the live server needs to composite at all: with
// none set, pieces still lock but no composite ever bakes, same as a real
// deployment with no R2 write creds.
//
// Must run before the server (re)starts, or against a stopped server: this
// script owns its own in-process Hub/GroupIndex/LockedPieceIndex/
// CellCompositor, entirely separate from any running server's.
//
// Then:
//   1. npm run validate-state -w @mpp/server -- --puzzle synthetic-1m-lock-test
//   2. start (or restart) the server against the same Redis/Mongo (boot rebuilds
//      the in-memory indexes from the seeded state)
//   3. connect a real browser client, pan across the board including
//      never-visited, locked cells: watch for hang/crash, resident piece
//      count staying under the client's budget, composite tiles baking
//      correctly over the locked regions.
// validate-state alone is necessary but not sufficient: it proves Redis/Mongo
// consistency, not client-side rendering survival, which needs a real
// connect-and-pan.

import { Redis as IORedis } from "ioredis";
import { MongoClient } from "mongodb";
import type { WebSocket } from "ws";
import {
  LeaderboardTracker,
  MinimapGridTracker,
  WORLD_TILE_SIZE,
  mulberry32,
  seedFromString,
  subseed,
} from "@mpp/shared";
import { loadConfig } from "./config.js";
import { RedisState } from "./state.js";
import { MongoLogger } from "./mongo.js";
import { forceInitPuzzle, playZoneForManifest } from "./init.js";
import { buildWireContext } from "./wire.js";
import { Hub, type Client } from "./hub.js";
import { GroupQueue } from "./queue.js";
import { GroupIndex } from "./groupIndex.js";
import { LockedPieceIndex } from "./lockedPieces.js";
import { cellKeyForGridId, CellCompositeIndex } from "./cellComposite.js";
import { CellCompositor } from "./cellCompositor.js";
import { createR2Client } from "./r2.js";
import { TokenBucket } from "./limits.js";
import { handleGrab, handleDrop, type Context } from "./handlers.js";

// Domain-separates this script's RNG stream from the generator's own (see
// init.ts's SCATTER_DOMAIN, generate.ts's HORIZONTAL_DOMAIN/VERTICAL_DOMAIN):
// distinct domains off the same generationSeed never correlate.
const LOCK_SCENARIO_DOMAIN = 3;
const DEFAULT_LOCKED_COUNT = 10000;
const DEFAULT_CONCURRENCY = 16;
// Bounded retry for the single end-of-run compositing pass: a cell that still
// has no composite after a markDirty+whenIdle round is re-marked and drained
// again, standing in for the later-lock self-heal live play gets for free.
const COMPOSITE_RETRY_ATTEMPTS = 3;

type Args = {
  redisUrl: string;
  mongoUrl: string;
  mongoDb: string;
  puzzleId: string;
  lockedCount: number;
  concurrency: number;
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
  const concurrency = args["concurrency"] ? Number(args["concurrency"]) : DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got "${args["concurrency"]}"`);
  }
  return {
    redisUrl: args["redis"] ?? "redis://127.0.0.1:6379",
    mongoUrl: args["mongo"] ?? "mongodb://127.0.0.1:27017",
    mongoDb: args["mongo-db"] ?? "mpp",
    puzzleId,
    lockedCount,
    concurrency,
  };
}

// Bernoulli-selects roughly lockedCount of [0, totalPieces) via a seeded RNG,
// deterministic per generationSeed (matching init.ts's domain-separated
// subseed convention, not Math.random()), so a re-run against the same
// puzzle id chooses the same set. Exactness to the piece doesn't matter, only
// the target fraction; the pieces left out stay in their natural scattered
// state, spread across the whole board rather than clumped.
function pickLockedIds(totalPieces: number, lockedCount: number, generationSeed: string): number[] {
  const fraction = Math.min(1, lockedCount / totalPieces);
  const rng = mulberry32(subseed(seedFromString(generationSeed), LOCK_SCENARIO_DOMAIN, 0, 0));
  const chosen: number[] = [];
  for (let id = 0; id < totalPieces; id++) {
    if (rng() < fraction) chosen.push(id);
  }
  return chosen;
}

// A stand-in WebSocket: handleGrab/handleDrop only ever write to it on an
// error path (grab_denied, rollback, tile_full, ...), which this scenario's
// single-writer, no-contention Redis access should never actually hit. Real
// enough to satisfy Client's type and survive a stray write if one ever does.
function fakeSocket(): WebSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    bufferedAmount: 0,
    send: () => {},
    close: () => {},
  } as unknown as WebSocket;
}

// Runs `task` over `items` with up to `concurrency` in flight at once. Safe
// here because every item is an independent, disjoint singleton group (no two
// tasks ever touch the same group id), so concurrent Redis operations never
// race on the same key.
async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++]!;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[seed-lock-scenario] puzzle=${args.puzzleId} lockedCount=${args.lockedCount} concurrency=${args.concurrency} redis=${args.redisUrl} mongo=${args.mongoUrl}/${args.mongoDb}`,
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
    if (!config.r2Write) {
      console.warn(
        "[seed-lock-scenario] MPP_R2_ENDPOINT/MPP_R2_ACCESS_KEY_ID/MPP_R2_SECRET_ACCESS_KEY unset: " +
          "pieces will lock, but no composite will ever bake, same as a real deployment with no R2 write creds.",
      );
    }
    const manifest = config.manifest;
    const meta = await forceInitPuzzle(state, manifest, config.generationSeed);

    const wire = buildWireContext(config.generationSeed, meta.totalPieces, meta.gridCols, meta.pieceSize);
    const cellSize = WORLD_TILE_SIZE;
    // A Hub with no added clients: broadcast/send walk an empty client set, so
    // every hub call handleGrab/handleDrop/applyMerge might make is a no-op.
    const hub = new Hub(config.wsBufferedAmountLimitBytes, cellSize, config.broadcastMaxCells);
    const groupIndex = new GroupIndex(cellSize);
    const lockedPieces = new LockedPieceIndex(
      meta.gridCols,
      meta.gridRows,
      meta.pieceSize,
      cellSize,
      meta.totalPieces,
    );
    const cellComposites = new CellCompositeIndex();
    const mongo = new MongoLogger(mongoClient.db(args.mongoDb));

    let cellCompositor: CellCompositor | undefined;
    if (config.r2Write) {
      const r2 = createR2Client(config.r2Write);
      cellCompositor = new CellCompositor({
        gridCols: meta.gridCols,
        gridRows: meta.gridRows,
        pieceSize: meta.pieceSize,
        margin: manifest.margin,
        cellSize,
        generationSeed: seedFromString(config.generationSeed),
        isLocked: (id) => lockedPieces.isLocked(id),
        upload: r2.upload,
        remove: r2.remove,
        removeByPrefix: r2.removeByPrefix,
        index: cellComposites,
        persistVersion: (key, version) => state.writeCellCompositeVersion(key, version),
        // No live client to broadcast a finished bake to.
        onComposited: () => {},
        puzzleId: manifest.puzzleId,
      });
    }

    const playZone = playZoneForManifest(manifest, config.generationSeed);
    const minimapGrid = new MinimapGridTracker(meta.gridCols, meta.pieceSize, playZone);
    // Fresh, like every other in-process index here: this script only ever
    // targets a fresh, unplayed puzzle (see the top-of-file comment), and the
    // leaderboard broadcast applyMerge triggers is a no-op anyway (no real
    // clients on this script's Hub).
    const leaderboardTracker = new LeaderboardTracker(meta.totalPieces);
    const solvedDensity = Math.round((cellSize / meta.pieceSize) ** 2);
    const tilePieceCap =
      config.tilePieceCapAbsolute > 0
        ? config.tilePieceCapAbsolute
        : solvedDensity * config.tilePieceCapMultiplier;

    const ctx: Context = {
      hub,
      state,
      meta,
      puzzleId: args.puzzleId,
      mongo,
      devEnabled: config.devEnabled,
      eventStartsAt: config.eventStartsAt,
      generationSeed: config.generationSeed,
      queue: new GroupQueue(),
      wire,
      groupIndex,
      lockedPieces,
      minimapGrid,
      leaderboardTracker,
      tilePieceCap,
      clusterPieceCap: config.clusterPieceCap,
      broadcastMaxCells: config.broadcastMaxCells,
      worldTileSize: cellSize,
      regionStreamBatchCells: config.regionStreamBatchCells,
      regionStreamPaceThresholdBytes: config.regionStreamPaceThresholdBytes,
      regionStreamPollIntervalMs: config.regionStreamPollIntervalMs,
    };
    // ctx.cellComposites/cellCompositor are intentionally left unset here:
    // handleDrop's markDirty call is guarded by `if (ctx.cellCompositor)`
    // (see handlers.ts), so leaving it unattached during the locking loop
    // below is a no-op there, the same as a deployment with no R2 write
    // credentials configured. Compositing is driven directly off the local
    // `cellCompositor` variable in one pass after the loop instead (see the
    // top-of-file comment for why).

    const chosenIds = pickLockedIds(meta.totalPieces, args.lockedCount, meta.generationSeed);
    console.log(
      `[seed-lock-scenario] locking ${chosenIds.length} of ${meta.totalPieces} pieces via the real grab/drop path`,
    );

    const client: Client = {
      userId: "seed-script",
      ws: fakeSocket(),
      bucket: new TokenBucket(1_000_000, 1_000_000),
      viewport: null,
      pseudo: "seed-script",
      held: new Set(),
      cells: new Set(),
      alive: true,
      regionStreamSeq: 0,
    };

    let done = 0;
    const logEvery = Math.max(1, Math.floor(chosenIds.length / 20));
    await runPool(chosenIds, args.concurrency, async (gridId) => {
      try {
        // Mirrors dispatch's own grab handling (see handlers.ts's "grab" case):
        // reserve in client.held before the acquire, same invariant a real
        // connection's disconnect cleanup depends on.
        client.held.add(gridId);
        await handleGrab(ctx, client, gridId);
        // Origin (0, 0), not the piece's own canonical world position: a
        // singleton's local AABB already bakes in its solved grid cell (see
        // worldGrid.ts), so (0, 0) is the internal origin that places it
        // there (see wire.ts's anchorWorldX/Y and handleDrop's frameAnchor
        // check). No `lockedGroups`: a direct call always applies
        // immediately. Safe here because a dropped singleton's only possible
        // neighbours are either not yet locked (too far from this drop's
        // target to ever become a loose-merge candidate) or already locked
        // (handled via detectSnap's touchesLocked path, which needs no group
        // lock at all; see snap.ts). matchedGroupIds is therefore always
        // empty in this scenario, so there is never a second group to hold.
        await handleDrop(ctx, client, gridId, 0, 0);
      } catch (e) {
        console.error(`[seed-lock-scenario] piece ${gridId} failed`, (e as Error).message);
      }
      done++;
      if (done % logEvery === 0 || done === chosenIds.length) {
        console.log(`[seed-lock-scenario] ${done}/${chosenIds.length} pieces processed`);
      }
    });

    if (cellCompositor) {
      const touchedCells = new Set(
        chosenIds.map((id) => cellKeyForGridId(id, meta.gridCols, meta.pieceSize, cellSize)),
      );
      console.log(
        `[seed-lock-scenario] compositing ${touchedCells.size} touched cell(s) in one pass...`,
      );
      let pending = touchedCells;
      for (let attempt = 1; attempt <= COMPOSITE_RETRY_ATTEMPTS && pending.size > 0; attempt++) {
        cellCompositor.markDirty(pending);
        await cellCompositor.whenIdle();
        pending = new Set([...pending].filter((key) => cellComposites.get(key) === undefined));
        if (pending.size > 0 && attempt < COMPOSITE_RETRY_ATTEMPTS) {
          console.warn(
            `[seed-lock-scenario] attempt ${attempt}: ${pending.size}/${touchedCells.size} cell(s) still missing a composite, retrying...`,
          );
        }
      }
      if (pending.size > 0) {
        console.error(
          `[seed-lock-scenario] ${pending.size}/${touchedCells.size} touched cell(s) have no composite after ${COMPOSITE_RETRY_ATTEMPTS} attempts: ${[...pending].join(",")}`,
        );
      } else {
        console.log(`[seed-lock-scenario] all ${touchedCells.size} touched cells composited`);
      }
    }

    console.log("[seed-lock-scenario] done");
  } finally {
    redis.disconnect();
    await mongoClient.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
