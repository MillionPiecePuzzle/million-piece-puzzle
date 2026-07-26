// One-off backfill: bakes level-0 cell composites for a board whose locked
// pieces were seeded directly in Redis (see seed-lock-scenario.ts), bypassing
// the live dirty-cell queue that normally composites a cell when a lock event
// touches it. Since Stage 5 retired the per-piece rendering fallback, a
// directly-seeded board has no locked-piece render path at all until this
// runs once. A board locked entirely through normal gameplay never needs
// this: every lock event already composites its own cell live.
//
// Marks every level-0 cell in the puzzle's frame dirty; the compositor's own
// per-cell logic (see CellCompositor.processLevelZeroCell) skips a cell with
// no locked piece, so this is correct to run unconditionally rather than
// first computing which cells actually have one. Only bakes level 0: run
// backfill-cell-composite-pyramid.ts afterward to build levels 1-3 on top.
// Safe to run more than once (see that script's own comment: a rerun just
// rebakes from whatever is currently locked, bumping versions again).
//
// CellCompositor's own drain loop is deliberately one-cell-at-a-time (see its
// header comment): correct for debouncing live traffic, far too slow for a
// cold bulk bake of a full board's worth of cells (measured ~20s/cell at
// ~99.5% locked density, ~7h for 1296 cells serially). This script instead
// runs `--concurrency` independent CellCompositor instances, each fed a
// disjoint round-robin slice of the cell list; safe because no cell key is
// ever touched by more than one lane, and the shared deps (index, upload,
// Redis writes) are either plain functions or single-threaded-JS-safe.
//
//   npm run backfill-cell-composite-level0 -w @mpp/server -- --puzzle synthetic-1m
//
// Requires the same R2 write credentials and MPP_ASSETS_BASE_URL/
// MPP_GENERATION_SEED the live server needs to composite at all (see
// config.ts).

import { Redis as IORedis } from "ioredis";
import { WORLD_TILE_SIZE } from "@mpp/shared";
import { loadConfig } from "./config.js";
import { RedisState } from "./state.js";
import { rebuildLockedPieceIndex } from "./init.js";
import { LockedPieceIndex } from "./lockedPieces.js";
import { buildWireContext } from "./wire.js";
import { CellCompositeIndex } from "./cellComposite.js";
import { CellCompositor } from "./cellCompositor.js";
import { cellKey } from "./worldGrid.js";
import { createR2Client } from "./r2.js";

type Args = { redisUrl: string; puzzleId: string; concurrency: number };

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
  const concurrency = args["concurrency"] ? Number(args["concurrency"]) : 16;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`--concurrency must be a positive integer, got "${args["concurrency"]}"`);
  }
  return { redisUrl: args["redis"] ?? "redis://127.0.0.1:6379", puzzleId, concurrency };
}

// Same public-HTTPS read the live server's own fetchPieceTile uses (see
// index.ts): no credentials, reading exactly what the frontend already fetches.
async function fetchPieceTile(
  assetsBaseUrl: string,
  puzzleId: string,
  relativePath: string,
): Promise<Buffer> {
  const url = `${assetsBaseUrl}/${puzzleId}/${relativePath}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`piece tile fetch ${url} returned HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[backfill-cell-composite-level0] puzzle=${args.puzzleId} redis=${args.redisUrl}`);
  const redis = new IORedis(args.redisUrl, { maxRetriesPerRequest: null });
  try {
    const config = await loadConfig({ puzzleId: args.puzzleId });
    if (!config.r2Write) {
      throw new Error(
        "MPP_R2_ENDPOINT/MPP_R2_ACCESS_KEY_ID/MPP_R2_SECRET_ACCESS_KEY must be set: backfilling with no R2 write credentials would do nothing.",
      );
    }
    const state = new RedisState(redis, args.puzzleId);
    if (!(await state.hasMeta())) {
      throw new Error(`puzzle "${args.puzzleId}" has no state in this Redis; nothing to backfill.`);
    }
    const meta = await state.readMeta();
    const manifest = config.manifest;

    const cellSize = WORLD_TILE_SIZE;
    const lockedPieces = new LockedPieceIndex(
      meta.gridCols,
      meta.gridRows,
      meta.pieceSize,
      cellSize,
      meta.totalPieces,
    );
    await rebuildLockedPieceIndex(lockedPieces, state, meta.totalPieces);

    const wire = buildWireContext(config.generationSeed, meta.totalPieces, meta.gridCols, meta.pieceSize);
    const r2 = createR2Client(config.r2Write);
    const cellComposites = new CellCompositeIndex();

    // Shared across every lane below: none of it is lane-specific mutable
    // state (CellCompositor's own dirty set/drain loop is the only per-lane
    // state, created fresh per instance), so one deps object is safe to hand
    // to several concurrent CellCompositor instances at once.
    const compositorDeps = {
      gridCols: meta.gridCols,
      gridRows: meta.gridRows,
      pieceSize: meta.pieceSize,
      margin: manifest.margin,
      cellSize,
      wire,
      pieceFileByWireId: (wireId: number) => manifest.pieces[wireId]!.file,
      isLocked: (id: number) => lockedPieces.isLocked(id),
      fetchTile: (relativePath: string) =>
        fetchPieceTile(config.assetsBaseUrl, manifest.puzzleId, relativePath),
      // Never called: this script only ever bakes level 0, which reads piece
      // tiles (fetchTile above), not an existing composite. A call here would
      // mean a real bug, not a value worth fabricating.
      fetchComposite: (): never => {
        throw new Error("level0 backfill never reads back a composite");
      },
      upload: r2.upload,
      remove: r2.remove,
      removeByPrefix: r2.removeByPrefix,
      index: cellComposites,
      persistVersion: (level: number, key: number, version: number) =>
        state.writeCellCompositeVersion(level, key, version),
      // No live clients to push to. Levels 1-3 are backfill-cell-composite-
      // pyramid.ts's job, run separately once every level-0 cell here is done.
      onComposited: () => {},
      puzzleId: manifest.puzzleId,
    };

    const cellCols = Math.ceil((meta.gridCols * meta.pieceSize) / cellSize);
    const cellRows = Math.ceil((meta.gridRows * meta.pieceSize) / cellSize);
    const allCellKeys: number[] = [];
    for (let cy = 0; cy < cellRows; cy++) {
      for (let cx = 0; cx < cellCols; cx++) {
        allCellKeys.push(cellKey(cx, cy));
      }
    }

    const lanes = Math.min(args.concurrency, allCellKeys.length);
    const chunks: number[][] = Array.from({ length: lanes }, () => []);
    allCellKeys.forEach((key, i) => chunks[i % lanes]!.push(key));
    console.log(
      `[backfill-cell-composite-level0] baking ${allCellKeys.length} cells across ${lanes} concurrent lanes`,
    );
    await Promise.all(
      chunks.map(async (chunk) => {
        const compositor = new CellCompositor(compositorDeps);
        compositor.markDirty(0, chunk);
        await compositor.whenIdle();
      }),
    );

    console.log("[backfill-cell-composite-level0] done");
  } finally {
    redis.disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
