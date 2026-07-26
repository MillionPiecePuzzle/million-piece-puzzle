// One-off backfill: builds pyramid levels 1-3 for an already-composited board
// (see ROADMAP Phase 5 Stage 4) from its current level-0 versions. Only ever
// needed once, for a board that already had level-0 composites before the
// pyramid existed (e.g. the live synthetic-1m board, composited under Stage 3
// alone); a board composited from here on builds its pyramid incrementally on
// its own, since a level-0 bake's own onComposited completion cascades
// upward as part of the normal lock path (see index.ts). Safe to run more
// than once: a rerun just rebakes every level from whatever is currently
// live, bumping versions again, the same redundant-but-harmless shape
// force-complete's own bulk re-dirty already accepts.
//
//   npm run backfill-cell-composite-pyramid -w @mpp/server -- --puzzle synthetic-1m
//
// Requires the same R2 write credentials the live server needs to composite
// at all (MPP_R2_ENDPOINT/MPP_R2_ACCESS_KEY_ID/MPP_R2_SECRET_ACCESS_KEY), plus
// MPP_ASSETS_BASE_URL/MPP_GENERATION_SEED, all read from the environment (see
// config.ts). Targets a puzzle that already has level-0 state in this Redis;
// a fresh, unplayed board has nothing to build the pyramid from and this
// script does nothing useful against one.

import { Redis as IORedis } from "ioredis";
import { WORLD_TILE_SIZE } from "@mpp/shared";
import { loadConfig } from "./config.js";
import { RedisState } from "./state.js";
import { buildWireContext } from "./wire.js";
import { MAX_CELL_COMPOSITE_LEVEL, CellCompositeIndex } from "./cellComposite.js";
import { rebuildCellCompositeIndex } from "./init.js";
import { CellCompositor } from "./cellCompositor.js";
import { createR2Client } from "./r2.js";
import { cellKey, unpackCellKey } from "./worldGrid.js";

type Args = { redisUrl: string; puzzleId: string };

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
  return { redisUrl: args["redis"] ?? "redis://127.0.0.1:6379", puzzleId };
}

// Reads back an already-baked cell composite (a level L-1 child, when baking
// level L>=1): the same plain public HTTPS read index.ts's own fetchComposite
// wiring uses, against the object's own already-fully-qualified key
// (puzzleId- and cells/-prefixed), not a manifest-relative piece path.
async function fetchCompositeTile(assetsBaseUrl: string, key: string): Promise<Buffer> {
  const url = `${assetsBaseUrl}/${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`composite tile fetch ${url} returned HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Every level-L cell key with at least one real level-(L-1) child, derived
// from level 0's own set of baked cells by repeated halving (see
// cellComposite.ts's parentCellKey). Only ever visits an ancestor of a cell
// that actually has a bake, rather than a bounding-box enumeration that would
// also touch cells with nothing locked in them at all.
function ancestorKeysAtLevel(level0Keys: readonly number[], level: number): number[] {
  let keys: readonly number[] = level0Keys;
  for (let l = 1; l <= level; l++) {
    const parents = new Set<number>();
    for (const key of keys) {
      const { cx, cy } = unpackCellKey(key);
      parents.add(cellKey(Math.floor(cx / 2), Math.floor(cy / 2)));
    }
    keys = [...parents];
  }
  return keys as number[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[backfill-cell-composite-pyramid] puzzle=${args.puzzleId} redis=${args.redisUrl}`);
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

    const level0Versions = await state.readCellCompositeVersions(0);
    const level0Keys = [...level0Versions.keys()];
    console.log(`[backfill-cell-composite-pyramid] ${level0Keys.length} level-0 composites found`);
    if (level0Keys.length === 0) {
      console.log("[backfill-cell-composite-pyramid] nothing to backfill, exiting");
      return;
    }

    const cellComposites = new CellCompositeIndex();
    await rebuildCellCompositeIndex(cellComposites, state, MAX_CELL_COMPOSITE_LEVEL);

    const r2 = createR2Client(config.r2Write);
    const compositor = new CellCompositor({
      gridCols: meta.gridCols,
      gridRows: meta.gridRows,
      pieceSize: meta.pieceSize,
      margin: config.manifest.margin,
      cellSize: WORLD_TILE_SIZE,
      wire: buildWireContext(config.generationSeed, meta.totalPieces, meta.gridCols, meta.pieceSize),
      // The three deps below back level 0's own bake only. This script never
      // marks level 0 dirty (it works purely from level 0's already-baked
      // versions, read above), so a call into any of them would mean a real
      // bug, not a value worth fabricating - throw loudly instead of silently
      // producing a wrong (e.g. always-unlocked) bake.
      pieceFileByWireId: (): never => {
        throw new Error("pyramid backfill never bakes level 0");
      },
      isLocked: (): never => {
        throw new Error("pyramid backfill never bakes level 0");
      },
      fetchTile: (): never => {
        throw new Error("pyramid backfill never bakes level 0");
      },
      fetchComposite: (key) => fetchCompositeTile(config.assetsBaseUrl, key),
      upload: r2.upload,
      remove: r2.remove,
      removeByPrefix: r2.removeByPrefix,
      index: cellComposites,
      persistVersion: (level, key, version) => state.writeCellCompositeVersion(level, key, version),
      // No live clients to push to, and no cascade needed: this script walks
      // the pyramid upward itself, one whole level at a time, below.
      onComposited: () => {},
      puzzleId: args.puzzleId,
    });

    for (let level = 1; level <= MAX_CELL_COMPOSITE_LEVEL; level++) {
      const keys = ancestorKeysAtLevel(level0Keys, level);
      console.log(`[backfill-cell-composite-pyramid] level ${level}: baking ${keys.length} cells`);
      compositor.markDirty(level, keys);
      await compositor.whenIdle();
    }

    console.log("[backfill-cell-composite-pyramid] done");
  } finally {
    redis.disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
