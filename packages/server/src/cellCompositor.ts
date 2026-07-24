// Debounced per-cell compositing queue (see ROADMAP Phase 5 Stage 3). A lock
// event marks its cell(s) dirty; a single background loop drains them one at a
// time, so a burst touching the same cell (a busy area filling in, or the dev
// force-complete shortcut re-dirtying the whole board at once) collapses into
// one rebake per cell instead of one per event. Mirrors the single-flight
// shape index.ts already uses for the keyframe publisher and the board-index
// resync (a boolean guard around an async pass, re-entrancy is a no-op).

import sharp from "sharp";
import { haloGridIdsForCell, type CellCompositeIndex } from "./cellComposite.js";
import { unpackCellKey } from "./worldGrid.js";
import { toWireId, type WireContext } from "./wire.js";

export type CellCompositorDeps = {
  gridCols: number;
  gridRows: number;
  pieceSize: number;
  margin: number;
  cellSize: number;
  wire: WireContext;
  // manifest.pieces[wireId].file, injected so this module does not need the
  // manifest shape itself.
  pieceFileByWireId: (wireId: number) => string;
  isLocked: (gridId: number) => boolean;
  // Public HTTPS read (the CDN-fronted asset domain), no credentials: reads
  // are exactly as public as the per-piece tiles the frontend already fetches.
  fetchTile: (relativePath: string) => Promise<Buffer>;
  // The one live write path to R2 this server has (see r2.ts); everything
  // else the server does with R2 is a plain public read.
  upload: (key: string, body: Buffer, contentType: string) => Promise<void>;
  // Deletes the version a rebake just superseded, once the new one is fully
  // live (index, Redis, broadcast), so R2 storage stays bounded by cell count
  // instead of growing with every lock event over the puzzle's whole
  // lifetime (see DECISIONS). A board reset is a separate, smaller gap this
  // does not cover: it clears the version index back to empty rather than
  // deleting the R2 objects, so a life that reaches fewer versions than the
  // one before a reset leaves that tail permanently orphaned.
  remove: (key: string) => Promise<void>;
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

export class CellCompositor {
  private readonly dirty = new Set<number>();
  private draining = false;
  private drainPromise: Promise<void> = Promise.resolve();

  constructor(private readonly deps: CellCompositorDeps) {}

  markDirty(cellKeys: Iterable<number>): void {
    for (const key of cellKeys) this.dirty.add(key);
    if (!this.draining) this.drainPromise = this.drain();
  }

  // Resolves once every currently and subsequently (mid-flight) dirtied cell
  // has been processed. Production callers never need this (markDirty is
  // fire-and-forget by design); it exists so a test can await a deterministic
  // point instead of guessing a timeout.
  whenIdle(): Promise<void> {
    return this.drainPromise;
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.dirty.size > 0) {
        const key = this.dirty.values().next().value as number;
        this.dirty.delete(key);
        try {
          await this.processCell(key);
        } catch (e) {
          // Logged and dropped, not retried: the next lock event that touches
          // this cell re-dirties and re-attempts the whole bake from scratch,
          // so a transient fetch/upload failure self-heals as long as the
          // cell is not yet at 100% locked. A failure on a cell's very last
          // lock (nothing left to ever re-dirty it) leaves it one version
          // stale (or with no composite at all), which force-complete or a
          // future admin reset re-sweeps; accepted, not worth a retry queue
          // for a rendering optimization the client already falls back from.
          console.error(`[cell-composite] cell ${key} failed`, (e as Error).message);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async processCell(cellKey: number): Promise<void> {
    const { gridCols, gridRows, pieceSize, margin, cellSize } = this.deps;
    const { cx, cy } = unpackCellKey(cellKey);
    const haloIds = haloGridIdsForCell(cx, cy, cellSize, gridCols, gridRows, pieceSize);
    const lockedIds = haloIds.filter((id) => this.deps.isLocked(id));
    if (lockedIds.length === 0) return;

    // The canvas is widened by margin on every side, exactly like an
    // individual piece tile is, so adjacent cell composites overlap the same
    // way individual piece tiles already do (see cellComposite.ts).
    const tileSize = pieceSize + 2 * margin;
    const canvasSize = cellSize + 2 * margin;
    const canvasOriginX = cx * cellSize - margin;
    const canvasOriginY = cy * cellSize - margin;

    const placements = await Promise.all(
      lockedIds.map(async (gridId) => {
        const col = gridId % gridCols;
        const row = Math.floor(gridId / gridCols);
        const tileLeft = col * pieceSize - margin - canvasOriginX;
        const tileTop = row * pieceSize - margin - canvasOriginY;
        const wireId = toWireId(this.deps.wire, gridId);
        const bytes = await this.deps.fetchTile(this.deps.pieceFileByWireId(wireId));
        return clipToCanvas(bytes, tileLeft, tileTop, tileSize, canvasSize);
      }),
    );
    const composite = placements.filter((p): p is Placement => p !== null);
    if (composite.length === 0) return;

    const buffer = await sharp({
      create: {
        width: canvasSize,
        height: canvasSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composite)
      .avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT })
      .toBuffer();

    const previousVersion = this.deps.index.get(cellKey) ?? 0;
    const version = previousVersion + 1;
    await this.deps.upload(this.compositeKey(cellKey, version), buffer, "image/avif");
    this.deps.index.set(cellKey, version);
    await this.deps.persistVersion(cellKey, version);
    this.deps.onComposited(cellKey, version);

    // The old version is now dead weight, not a fallback anyone still reads:
    // every reader that could learn of this cell (index, Redis, the broadcast
    // above) already points at the new version. Best-effort: a failure here
    // is logged and leaves that one object orphaned permanently, since
    // nothing revisits a specific past version's cleanup again, unlike a
    // failed bake itself, which the next lock event on this cell re-attempts.
    if (previousVersion > 0) {
      try {
        await this.deps.remove(this.compositeKey(cellKey, previousVersion));
      } catch (e) {
        console.error(
          `[cell-composite] cell ${cellKey} failed to delete stale v${previousVersion}`,
          (e as Error).message,
        );
      }
    }
  }

  private compositeKey(cellKey: number, version: number): string {
    return `${this.deps.puzzleId}/cells/${cellKey}/${version}.avif`;
  }
}

type Placement = { input: Buffer; left: number; top: number };

// sharp's composite() requires an input no larger than the base canvas and
// placed fully inside it (an offscreen tile throws rather than clipping), so a
// halo piece whose tile bleeds past the canvas edge has to be cropped to its
// own visible sliver first, the same clamped-extract shape the slicer already
// uses when a piece's own tile window overhangs the source image (see
// scripts/slice-image.ts). Returns null when the tile does not actually reach
// the canvas at all (haloGridIdsForCell over-includes by up to one piece, see
// its own comment).
async function clipToCanvas(
  tileBuf: Buffer,
  tileLeft: number,
  tileTop: number,
  tileSize: number,
  canvasSize: number,
): Promise<Placement | null> {
  const visibleLeft = Math.max(0, tileLeft);
  const visibleTop = Math.max(0, tileTop);
  const visibleRight = Math.min(canvasSize, tileLeft + tileSize);
  const visibleBottom = Math.min(canvasSize, tileTop + tileSize);
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

  const cropLeft = visibleLeft - tileLeft;
  const cropTop = visibleTop - tileTop;
  const width = visibleRight - visibleLeft;
  const height = visibleBottom - visibleTop;
  const fullyInside = cropLeft === 0 && cropTop === 0 && width === tileSize && height === tileSize;
  const input = fullyInside
    ? tileBuf
    : await sharp(tileBuf).extract({ left: cropLeft, top: cropTop, width, height }).toBuffer();
  return { input, left: visibleLeft, top: visibleTop };
}
