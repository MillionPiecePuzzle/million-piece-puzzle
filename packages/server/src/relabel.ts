/**
 * Boot reconciliation between the seed a board was generated under and the seed
 * the server is now loading.
 *
 * The generation seed drives the wire id permutation, and the R2 tiles are named
 * by `wireId = P(seed, gridId)` (see scripts/slice-image.ts), so a board built
 * under one seed and served under another hands every client the art and
 * silhouette of a piece that belongs to a different solved cell. Nothing can
 * ever snap: a drop is judged on position alone, and the position a player aims
 * at is the one the art points to, never the one the server expects.
 *
 * The repair is a relabeling, not a wipe: while every group is still a
 * singleton, the two boards differ only by which id holds which position, so
 * permuting the stored origins puts every piece back under its own id with its
 * rendered position unchanged to the pixel.
 */

import { buildPermutation, type GroupRuntime } from "@mpp/shared";
import type { PuzzleMeta, StoredPiece } from "./state.js";

export type BoardOrigin = { id: number; worldX: number; worldY: number };

export type BoardSeedStore = {
  readAllGroups(totalPieces: number): Promise<GroupRuntime[]>;
  readAllPieces(totalPieces: number): Promise<StoredPiece[]>;
  setGroupPositions(entries: readonly BoardOrigin[]): Promise<void>;
  saveOriginBackup(entries: readonly BoardOrigin[]): Promise<void>;
  readOriginBackup(): Promise<BoardOrigin[] | null>;
  clearOriginBackup(): Promise<void>;
  writeMeta(meta: PuzzleMeta): Promise<void>;
};

// The grid id currently holding the piece that renders as `id` under `toSeed`.
// A client loads a tile by wire id, so the board under `fromSeed` shows
// `P(from)^-1(P(to)(id))`'s tile where the board under `toSeed` shows `id`'s.
export function sourceForTarget(fromSeed: string, toSeed: string, totalPieces: number): Int32Array {
  const from = buildPermutation(fromSeed, totalPieces);
  const to = buildPermutation(toSeed, totalPieces);
  const out = new Int32Array(totalPieces);
  for (let id = 0; id < totalPieces; id++) out[id] = from.gridForWire[to.wireForGrid[id]!]!;
  return out;
}

// A relabeling is only meaningful while every piece is its own loose group: a
// merged cluster froze the relative offsets of the ids it joined and a locked
// piece committed to a solved cell, so neither survives being renamed.
function assertRelabelable(
  pieces: readonly StoredPiece[],
  groups: readonly GroupRuntime[],
  totalPieces: number,
): void {
  const refuse = (reason: string): never => {
    throw new Error(
      `board seed mismatch cannot be relabeled: ${reason}. ` +
        `Restore the seed the board was generated with, or wipe the puzzle and let it re-init.`,
    );
  };
  if (pieces.length !== totalPieces)
    refuse(`read ${pieces.length} pieces, expected ${totalPieces}`);
  if (groups.length !== totalPieces)
    refuse(`${totalPieces - groups.length} groups already merged away`);
  for (const p of pieces) {
    if (p.locked) refuse(`piece ${p.id} is locked`);
    if (p.groupId !== p.id) refuse(`piece ${p.id} sits in group ${p.groupId}`);
  }
  for (const g of groups) {
    if (g.size !== 1) refuse(`group ${g.id} holds ${g.size} pieces`);
  }
}

// A piece renders at `origin + canonicalOffset(gridId)`, so holding every piece
// on the pixel it already occupies means giving the target id the source id's
// rendered anchor, corrected by the two solved cells.
export function relabelOrigins(
  origins: readonly BoardOrigin[],
  sources: Int32Array,
  gridCols: number,
  pieceSize: number,
): BoardOrigin[] {
  const total = sources.length;
  const x = new Float64Array(total);
  const y = new Float64Array(total);
  for (const o of origins) {
    x[o.id] = o.worldX;
    y[o.id] = o.worldY;
  }
  const offsetX = (id: number): number => (id % gridCols) * pieceSize;
  const offsetY = (id: number): number => Math.floor(id / gridCols) * pieceSize;
  const out = new Array<BoardOrigin>(total);
  for (let id = 0; id < total; id++) {
    const src = sources[id]!;
    out[id] = {
      id,
      worldX: x[src]! + offsetX(src) - offsetX(id),
      worldY: y[src]! + offsetY(src) - offsetY(id),
    };
  }
  return out;
}

export async function reconcileBoardSeed(
  store: BoardSeedStore,
  meta: PuzzleMeta,
  loadedSeed: string,
): Promise<PuzzleMeta> {
  if (meta.generationSeed === loadedSeed) {
    // Covers the crash window between committing the new seed and dropping the
    // snapshot: the board is already correct, the leftover is just memory.
    await store.clearOriginBackup();
    return meta;
  }
  console.warn(
    `[seed-relabel] board carries a different generation seed, relabeling ${meta.totalPieces} pieces onto the loaded one`,
  );
  const started = Date.now();
  const [pieces, groups] = await Promise.all([
    store.readAllPieces(meta.totalPieces),
    store.readAllGroups(meta.totalPieces),
  ]);
  assertRelabelable(pieces, groups, meta.totalPieces);

  // A snapshot short of the whole board can only come from a crash while
  // writing it, which is before any position was touched, so the live groups
  // are still the pre-relabel state and the partial snapshot is just refilled.
  const snapshot = await store.readOriginBackup();
  const resumable = snapshot?.length === meta.totalPieces ? snapshot : null;
  if (resumable) console.warn("[seed-relabel] resuming from the snapshot of an interrupted run");
  const origins = resumable ?? groups;
  if (!resumable) await store.saveOriginBackup(origins);

  const sources = sourceForTarget(meta.generationSeed, loadedSeed, meta.totalPieces);
  await store.setGroupPositions(relabelOrigins(origins, sources, meta.gridCols, meta.pieceSize));
  const migrated = { ...meta, generationSeed: loadedSeed };
  await store.writeMeta(migrated);
  await store.clearOriginBackup();
  console.warn(`[seed-relabel] done in ${Date.now() - started}ms, rendered positions unchanged`);
  return migrated;
}
