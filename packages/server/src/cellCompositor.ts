// Debounced per-cell compositing queue (see ROADMAP Phase 5 Stage 3). A lock
// event marks its cell(s) dirty; a single background loop drains dirty cells
// one at a time, so a burst touching the same cell (a busy area filling in,
// or the dev force-complete shortcut re-dirtying the whole board at once)
// collapses into one rebake per cell instead of one per event. Mirrors the
// single-flight shape index.ts already uses for the keyframe publisher and
// the board-index resync (a boolean guard around an async pass, re-entrancy
// is a no-op).

import sharp from "sharp";
import {
  CELL_MASK_TIER_FACTORS,
  generatePieceGeometry,
  pieceBorderSvg,
  pieceMaskSvg,
  piecePath,
  piecePathD,
} from "@mpp/shared";
import { haloGridIdsForCell, type CellCompositeIndex } from "./cellComposite.js";
import { unpackCellKey } from "./worldGrid.js";

export type CellCompositorDeps = {
  gridCols: number;
  gridRows: number;
  pieceSize: number;
  margin: number;
  cellSize: number;
  // The server's own copy of the puzzle's generation seed (see DECISIONS:
  // anti-programmatic-solving), already held in-process for every other
  // seed-derived computation this server does (canonical offsets, play zone,
  // etc.). Reused here to rebuild a locked piece's own silhouette on demand for
  // the mask/seam bake below, the same way the offline slicer derives it, with
  // nothing new exposed: the seed itself never leaves this process.
  generationSeed: number;
  isLocked: (gridId: number) => boolean;
  // The one live write path to R2 this server has (see r2.ts); everything
  // else the server does with R2 is a plain public read.
  upload: (key: string, body: Buffer, contentType: string) => Promise<void>;
  // Deletes the version a rebake just superseded, once the new one is fully
  // live (index, Redis, broadcast), so R2 storage stays bounded by cell count
  // instead of growing with every lock event over the puzzle's whole
  // lifetime (see DECISIONS). A board reset's own cleanup goes through
  // removeByPrefix below instead of this: the index it would otherwise read
  // the cell's last version from is exactly what a reset empties.
  remove: (key: string) => Promise<void>;
  // Bulk delete used only by a board reset (see clearAll): removes every
  // object under a prefix, catching every version any past life of this
  // puzzle ever wrote for a cell, not just the one the (already-cleared)
  // version index last pointed to.
  removeByPrefix: (prefix: string) => Promise<void>;
  index: CellCompositeIndex;
  persistVersion: (cellKey: number, version: number) => Promise<void>;
  onComposited: (cellKey: number, version: number) => void;
  puzzleId: string;
};

// Matches the slicer's own AVIF settings (scripts/slice-image.ts) so a
// composited cell tile is not visibly more compressed than the individual
// piece tiles it replaces.
const AVIF_QUALITY = 60;
const AVIF_EFFORT = 4;
// Bound on whole-cell bake attempts (see drain's catch block below): an R2
// upload failure or a sharp exception fails the whole cell, so a failed bake
// is retried a bounded number of times before being logged and dropped.
const CELL_BAKE_MAX_ATTEMPTS = 3;

export class CellCompositor {
  private readonly dirty = new Set<number>();
  // Attempt count for a cell currently mid-retry (see drain). Absent for a
  // cell on its first attempt, and cleared again once it either succeeds or
  // exhausts CELL_BAKE_MAX_ATTEMPTS.
  private readonly bakeAttempts = new Map<number, number>();
  private draining = false;
  private drainPromise: Promise<void> = Promise.resolve();

  constructor(private readonly deps: CellCompositorDeps) {}

  markDirty(cellKeys: Iterable<number>): void {
    for (const key of cellKeys) this.dirty.add(key);
    if (!this.draining) this.drainPromise = this.drain();
  }

  // Resolves once every currently and subsequently (mid-flight) dirtied cell
  // has been processed. Production callers never need this (markDirty is
  // fire-and-forget by design); it exists so a test can await a
  // deterministic point instead of guessing a timeout.
  whenIdle(): Promise<void> {
    return this.drainPromise;
  }

  // Backlog size, for polling a long-running bulk markDirty (e.g. an admin
  // resweep) from outside without awaiting whenIdle, which would hold an HTTP
  // request open for as long as the whole backlog takes to drain. Includes
  // cells currently mid-retry (see drain), so polling this down to 0 means
  // every cell got its full CELL_BAKE_MAX_ATTEMPTS budget, not just one pass.
  pendingCount(): number {
    return this.dirty.size;
  }

  // Bulk-deletes every composite object this puzzle's cells have ever had,
  // used by a board reset (see PuzzleLifecycle.resetCurrent). A per-key
  // delete of each cell's last-known version cannot do this job: the reset
  // empties the version index before (or instead of) reading it, and even a
  // version read beforehand would miss any object a still-earlier reset
  // already orphaned. Deleting the whole <puzzleId>/cells/ prefix catches all
  // of them at once, regardless of how many past lives left one behind.
  async clearAll(): Promise<void> {
    this.bakeAttempts.clear();
    await this.deps.removeByPrefix(`${this.deps.puzzleId}/cells/`);
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.dirty.size > 0) {
        const key = this.dirty.values().next().value as number;
        this.dirty.delete(key);
        try {
          await this.processCell(key);
          this.bakeAttempts.delete(key);
        } catch (e) {
          const attempt = (this.bakeAttempts.get(key) ?? 0) + 1;
          if (attempt < CELL_BAKE_MAX_ATTEMPTS) {
            // Requeued, not dropped: re-adding to `dirty` lets this same
            // drain loop retry it once every other currently-queued cell has
            // had its own turn first, a natural backoff with no timer
            // needed. A live lock event re-dirtying this cell independently
            // still behaves the same as before (whenever the retry succeeds,
            // the attempt counter clears), so this is only ever an extra
            // ceiling on top of that, never a replacement for it.
            this.bakeAttempts.set(key, attempt);
            this.dirty.add(key);
            console.warn(
              `[cell-composite] cell ${key} failed (attempt ${attempt}/${CELL_BAKE_MAX_ATTEMPTS}), retrying`,
              (e as Error).message,
            );
          } else {
            // Logged and dropped for good, the genuine last resort: since
            // CompositeTileLayer replaced the per-piece fallback (see
            // DECISIONS), a cell that never gets a composite renders
            // nothing, not degraded content, so this can no longer be
            // accepted as a steady state the way it once was. A later lock
            // event touching this cell still gets its own fresh
            // CELL_BAKE_MAX_ATTEMPTS budget; a fully-locked cell with none
            // left needs a force-complete or admin resweep to try again.
            this.bakeAttempts.delete(key);
            console.error(
              `[cell-composite] cell ${key} failed after ${CELL_BAKE_MAX_ATTEMPTS} attempts, giving up`,
              (e as Error).message,
            );
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }

  // Composites a cell's silhouette mask and seam (border-only) texture,
  // rasterized straight from the currently-locked pieces' own geometry (see
  // DECISIONS: DZI reveal mask and seam baked server-side). The two always
  // bake and version together: a mask/seam pair only ever means something
  // for the same lockedIds and canvas, so there is no case where one would
  // need rebaking without the other.
  private async processCell(key: number): Promise<void> {
    const { gridCols, gridRows, pieceSize, margin, cellSize, generationSeed } = this.deps;
    const { cx, cy } = unpackCellKey(key);
    const haloIds = haloGridIdsForCell(cx, cy, cellSize, gridCols, gridRows, pieceSize);
    const lockedIds = haloIds.filter((id) => this.deps.isLocked(id));
    if (lockedIds.length === 0) return;

    // The canvas is widened by margin on every side, exactly like an
    // individual piece tile is, so adjacent cell composites overlap the same
    // way individual piece tiles already do (see cellComposite.ts).
    const canvasSize = cellSize + 2 * margin;
    const canvasOriginX = cx * cellSize - margin;
    const canvasOriginY = cy * cellSize - margin;

    // Pure geometry, no fetch: a locked piece's silhouette is a function of
    // (generationSeed, gridId) alone, already held in-process. Each piece's
    // own path is placed at its true canvas-local position with no extra
    // margin term: the path's coordinates already carry a tab's true
    // overflow past the piece's nominal [0, pieceSize] box, so no separate
    // bleed accounting is needed the way a fixed-size raster tile would
    // require (see DECISIONS: tile margin).
    const pathDs = lockedIds.map((gridId) => {
      const col = gridId % gridCols;
      const row = Math.floor(gridId / gridCols);
      const geom = generatePieceGeometry(generationSeed, gridRows, gridCols, pieceSize, gridId);
      return piecePathD(
        piecePath(geom, pieceSize),
        col * pieceSize - canvasOriginX,
        row * pieceSize - canvasOriginY,
      );
    });
    const [maskTiers, seamTiers] = await Promise.all([
      bakeTiers(pieceMaskSvg(pathDs, canvasSize, canvasSize), canvasSize),
      bakeTiers(pieceBorderSvg(pathDs, canvasSize, canvasSize), canvasSize),
    ]);

    await this.finishBake(key, maskTiers, seamTiers);
  }

  // Bump the version, upload every mask/seam tier, update the in-process
  // index, persist to Redis, report completion (the caller broadcasts, see
  // index.ts), then best-effort delete the now-superseded version. Every
  // tier shares one version number: the client derives every URL from the
  // same {cellKey, version} pair already on the wire (see protocol.ts's
  // CellComposite) plus its own choice of variant/tier (see DECISIONS: DZI
  // reveal mask/seam LOD tiers), so no wire shape change is needed.
  private async finishBake(key: number, maskTiers: Buffer[], seamTiers: Buffer[]): Promise<void> {
    const previousVersion = this.deps.index.get(key) ?? 0;
    const version = previousVersion + 1;
    const uploads: Promise<void>[] = [];
    for (let tier = 0; tier < CELL_MASK_TIER_FACTORS.length; tier++) {
      uploads.push(
        this.deps.upload(
          this.objectKey(key, version, "mask", tier),
          maskTiers[tier]!,
          "image/avif",
        ),
      );
      uploads.push(
        this.deps.upload(
          this.objectKey(key, version, "seam", tier),
          seamTiers[tier]!,
          "image/avif",
        ),
      );
    }
    await Promise.all(uploads);
    this.deps.index.set(key, version);
    await this.deps.persistVersion(key, version);
    this.deps.onComposited(key, version);

    // The old version's tiers are now dead weight, not a fallback anyone
    // still reads: every reader that could learn of this cell (index, Redis,
    // the broadcast above) already points at the new version. Best-effort: a
    // failure here is logged and leaves that object orphaned permanently,
    // since nothing revisits a specific past version's cleanup again, unlike
    // a failed bake itself, which the next dirty mark on this cell
    // re-attempts.
    if (previousVersion > 0) {
      try {
        const removals: Promise<void>[] = [];
        for (let tier = 0; tier < CELL_MASK_TIER_FACTORS.length; tier++) {
          removals.push(this.deps.remove(this.objectKey(key, previousVersion, "mask", tier)));
          removals.push(this.deps.remove(this.objectKey(key, previousVersion, "seam", tier)));
        }
        await Promise.all(removals);
      } catch (e) {
        console.error(
          `[cell-composite] cell ${key} failed to delete stale v${previousVersion}`,
          (e as Error).message,
        );
      }
    }
  }

  private objectKey(key: number, version: number, variant: "mask" | "seam", tier: number): string {
    return `${this.deps.puzzleId}/cells/${key}/${version}-${variant}-${tier}.avif`;
  }
}

// Renders one SVG source at every configured mask/seam LOD tier, sharing the
// same decoded rasterization across tiers (sharp's clone() branches a
// pipeline without re-parsing the source) rather than re-rendering the SVG
// once per tier.
async function bakeTiers(svg: Buffer, canvasSize: number): Promise<Buffer[]> {
  const base = sharp(svg);
  return Promise.all(
    CELL_MASK_TIER_FACTORS.map((factor) => {
      const pipeline = base.clone();
      if (factor > 1) {
        const size = Math.max(1, Math.round(canvasSize / factor));
        pipeline.resize(size, size);
      }
      return pipeline.avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT }).toBuffer();
    }),
  );
}
