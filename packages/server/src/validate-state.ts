// Post-soak state-corruption validator.
//
// Reads a puzzle's authoritative state straight from Redis and Mongo (the board
// at rest, after every load-test bot has disconnected) and asserts the
// invariants in stateInvariants.ts: piece/group partition consistency, locked
// accounting, no leftover holders, and Mongo<->Redis partition equality from
// replaying the merge log. Prints a per-check report and exits non-zero on any
// failure, so it doubles as a CI/soak gate.
//
// Point --redis / --mongo at the same stores the target server uses. For prod
// (Redis and Mongo not publicly exposed) run this on the VPS, or over an SSH
// tunnel to those ports.
//
//   npm run validate-state -w @mpp/server -- \
//     --redis redis://127.0.0.1:6379 \
//     --mongo mongodb://127.0.0.1:27017 --mongo-db mpp \
//     --puzzle test-puzzle-10k

import { Redis as IORedis } from "ioredis";
import { MongoClient } from "mongodb";
import { RedisState } from "./state.js";
import * as keys from "./redis/keys.js";
import {
  runInvariants,
  type Check,
  type GroupState,
  type MergeRecord,
  type StateSnapshot,
} from "./stateInvariants.js";

type Args = {
  redisUrl: string;
  mongoUrl: string;
  mongoDb: string;
  puzzleId: string;
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
  };
}

async function readGroupPieces(
  redis: IORedis,
  puzzleId: string,
  groupIds: number[],
): Promise<Map<number, Set<number>>> {
  const out = new Map<number, Set<number>>();
  const CHUNK = 2000;
  for (let start = 0; start < groupIds.length; start += CHUNK) {
    const slice = groupIds.slice(start, start + CHUNK);
    const pipe = redis.pipeline();
    for (const id of slice) pipe.smembers(keys.groupPieces(puzzleId, id));
    const results = await pipe.exec();
    if (!results) continue;
    for (let i = 0; i < slice.length; i++) {
      const members = (results[i]?.[1] as string[] | undefined) ?? [];
      out.set(slice[i]!, new Set(members.map(Number)));
    }
  }
  return out;
}

async function readSnapshot(redis: IORedis, puzzleId: string): Promise<StateSnapshot> {
  const state = new RedisState(redis, puzzleId);
  if (!(await state.hasMeta())) {
    throw new Error(`no puzzle meta for "${puzzleId}" in this Redis (wrong --puzzle or --redis?)`);
  }
  const meta = await state.readMeta();
  const total = meta.totalPieces;
  const groupRuntimes = await state.readAllGroups(total);
  const groups: GroupState[] = groupRuntimes.map((g) => ({
    id: g.id,
    size: g.size,
    locked: g.locked,
    heldBy: g.heldBy,
  }));
  const pieces = await state.readAllPieces(total);
  const pieceGroup = new Map<number, number>();
  for (const p of pieces) {
    if (Number.isFinite(p.groupId)) pieceGroup.set(p.id, p.groupId);
  }
  const groupPieces = await readGroupPieces(
    redis,
    puzzleId,
    groups.map((g) => g.id),
  );
  const lockedCount = await state.getLockedCount();
  return { totalPieces: total, groups, pieceGroup, groupPieces, lockedCount };
}

type MergeProjection = {
  addedPieceIds: number[];
  targetAnchorPieceId: number;
  anchored: boolean;
  lockedDelta: number;
  at: Date;
};

async function readMerges(
  client: MongoClient,
  dbName: string,
  puzzleId: string,
): Promise<MergeRecord[]> {
  const docs = await client
    .db(dbName)
    .collection<MergeProjection>("cluster_merges")
    .find(
      { puzzleId },
      {
        projection: {
          addedPieceIds: 1,
          targetAnchorPieceId: 1,
          anchored: 1,
          lockedDelta: 1,
          at: 1,
        },
      },
    )
    .toArray();
  return docs.map((d) => ({
    addedPieceIds: d.addedPieceIds ?? [],
    targetAnchorPieceId: d.targetAnchorPieceId,
    anchored: !!d.anchored,
    lockedDelta: d.lockedDelta ?? 0,
    at: d.at instanceof Date ? d.at.getTime() : Number(d.at),
  }));
}

function printReport(checks: Check[]): boolean {
  console.log("");
  console.log("=== state-corruption report ===");
  let allOk = true;
  for (const c of checks) {
    if (!c.ok) allOk = false;
    console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
    console.log(`        ${c.detail}`);
  }
  console.log("");
  console.log(`verdict: ${allOk ? "PASS" : "FAIL"}`);
  return allOk;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[validate] puzzle=${args.puzzleId} redis=${args.redisUrl} mongo=${args.mongoUrl}/${args.mongoDb}`,
  );
  const redis = new IORedis(args.redisUrl, { maxRetriesPerRequest: null });
  const mongo = new MongoClient(args.mongoUrl);
  let ok = false;
  try {
    await mongo.connect();
    const snap = await readSnapshot(redis, args.puzzleId);
    const merges = await readMerges(mongo, args.mongoDb, args.puzzleId);
    console.log(
      `[validate] groups=${snap.groups.length} totalPieces=${snap.totalPieces} merges=${merges.length} locked-count=${snap.lockedCount}`,
    );
    ok = printReport(runInvariants(snap, merges));
  } finally {
    redis.disconnect();
    await mongo.close();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
