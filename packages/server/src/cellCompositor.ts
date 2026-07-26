// Debounced per-cell compositing queue (see ROADMAP Phase 5 Stage 3, extended
// to a multi-level pyramid by Stage 4). A lock event marks its level-0 cell(s)
// dirty; a single background loop drains dirty (level, cell) pairs one at a
// time, so a burst touching the same cell (a busy area filling in, or the dev
// force-complete shortcut re-dirtying the whole board at once) collapses into
// one rebake per cell instead of one per event. A level L>=1 cell is never
// dirtied directly by an origin event, only by its own child's onComposited
// completion (wired by the caller, see index.ts), so a parent can never
// recomposite from a stale child. Mirrors the single-flight shape index.ts
// already uses for the keyframe publisher and the board-index resync (a
// boolean guard around an async pass, re-entrancy is a no-op).

import sharp from "sharp";
import { haloGridIdsForCell, type CellCompositeIndex } from "./cellComposite.js";
import { cellKey, unpackCellKey } from "./worldGrid.js";
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
  // Takes a manifest-relative piece path (see pieceFileByWireId), used only by
  // level 0's own bake.
  fetchTile: (relativePath: string) => Promise<Buffer>;
  // Reads back an already-baked composite (a level L-1 child, when baking
  // level L>=1): a plain public HTTPS read of the object's full R2 key (the
  // same shape upload/remove below take), distinct from fetchTile above,
  // which takes a manifest-relative piece path instead.
  fetchComposite: (key: string) => Promise<Buffer>;
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
  // puzzle ever wrote for a cell at any level, not just the one the
  // (already-cleared) version index last pointed to.
  removeByPrefix: (prefix: string) => Promise<void>;
  index: CellCompositeIndex;
  persistVersion: (level: number, cellKey: number, version: number) => Promise<void>;
  onComposited: (level: number, cellKey: number, version: number) => void;
  puzzleId: string;
};

// Matches the slicer's own AVIF settings (scripts/slice-image.ts) so a
// composited cell tile is not visibly more compressed than the individual
// piece tiles it replaces.
const AVIF_QUALITY = 60;
const AVIF_EFFORT = 4;

// Packs a dirty (level, key) pair into one Set entry. Levels never exceed
// MAX_CELL_COMPOSITE_LEVEL (3), so 2 bits comfortably separates them from a
// cellKey packed up to ~2^48 (see worldGrid.ts), well inside Number's safe
// integer range.
const DIRTY_LEVEL_STRIDE = 4;
function packDirty(level: number, key: number): number {
  return key * DIRTY_LEVEL_STRIDE + level;
}
function unpackDirty(packed: number): { level: number; key: number } {
  return { level: packed % DIRTY_LEVEL_STRIDE, key: Math.floor(packed / DIRTY_LEVEL_STRIDE) };
}

export class CellCompositor {
  private readonly dirty = new Set<number>();
  private draining = false;
  private drainPromise: Promise<void> = Promise.resolve();

  constructor(private readonly deps: CellCompositorDeps) {}

  // level 0 for a lock event or force-complete (the only origin-event
  // callers); a level L>=1 mark only ever comes from a child's own
  // onComposited completion (see index.ts) or the one-off pyramid backfill.
  markDirty(level: number, cellKeys: Iterable<number>): void {
    for (const key of cellKeys) this.dirty.add(packDirty(level, key));
    if (!this.draining) this.drainPromise = this.drain();
  }

  // Resolves once every currently and subsequently (mid-flight) dirtied cell
  // has been processed. Production callers never need this (markDirty is
  // fire-and-forget by design); it exists so a test (or the one-off backfill
  // script) can await a deterministic point instead of guessing a timeout.
  whenIdle(): Promise<void> {
    return this.drainPromise;
  }

  // Bulk-deletes every composite object this puzzle's cells have ever had, at
  // any level, used by a board reset (see PuzzleLifecycle.resetCurrent). A
  // per-key delete of each cell's last-known version cannot do this job: the
  // reset empties the version index before (or instead of) reading it, and
  // even a version read beforehand would miss any object a still-earlier
  // reset already orphaned. Deleting the whole <puzzleId>/cells/ prefix
  // catches all of them at once (every level's objects live under it, see
  // objectKey), regardless of how many past lives left one behind.
  async clearAll(): Promise<void> {
    await this.deps.removeByPrefix(`${this.deps.puzzleId}/cells/`);
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      while (this.dirty.size > 0) {
        const packed = this.dirty.values().next().value as number;
        this.dirty.delete(packed);
        const { level, key } = unpackDirty(packed);
        try {
          await this.processCell(level, key);
        } catch (e) {
          // Logged and dropped, not retried: the next event that re-dirties
          // this (level, cell) - another lock touching it at level 0, or its
          // own child's next completion at level>=1 - re-attempts the whole
          // bake from scratch, so a transient fetch/upload failure self-heals
          // as long as the cell is not yet at 100% locked. A failure on a
          // cell's very last lock (nothing left to ever re-dirty it) leaves
          // it one version stale (or with no composite at all), which
          // force-complete or a future admin reset re-sweeps; accepted, not
          // worth a retry queue for a rendering optimization the client
          // already falls back from.
          console.error(`[cell-composite] level ${level} cell ${key} failed`, (e as Error).message);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async processCell(level: number, key: number): Promise<void> {
    if (level === 0) return this.processLevelZeroCell(key);
    return this.processPyramidCell(level, key);
  }

  // Unchanged from Stage 3: composites a cell's currently-locked piece tiles.
  private async processLevelZeroCell(key: number): Promise<void> {
    const { gridCols, gridRows, pieceSize, margin, cellSize } = this.deps;
    const { cx, cy } = unpackCellKey(key);
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

    await this.finishBake(0, key, buffer);
  }

  // A level L>=1 tile composites up to 4 already-baked level L-1 children at
  // their 2x2 offsets, using each child's own full, uncropped canvas (not an
  // analytically-cropped one) so the fixed-pixel edge overlap that canvas
  // already carries propagates into this level too (see DECISIONS: pyramid
  // tile overlap is a fixed pixel count), then resizes down to the pyramid's
  // one fixed per-tile pixel size, the same size level 0 already outputs
  // natively. A missing child (grid edges, where a level's own grid does not
  // halve evenly - see DECISIONS: composite pyramid stops at level 3) is
  // simply omitted, the same "composite whichever exist" shape level 0 uses
  // for a partially-locked cell.
  private async processPyramidCell(level: number, key: number): Promise<void> {
    const { cellSize, margin } = this.deps;
    const tileSize = cellSize + 2 * margin;
    const rawSize = 2 * cellSize + 2 * margin;
    const { cx, cy } = unpackCellKey(key);
    const childLevel = level - 1;
    const offsets: [col: number, row: number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];

    const placements = await Promise.all(
      offsets.map(async ([col, row]) => {
        const childKey = cellKey(cx * 2 + col, cy * 2 + row);
        const version = this.deps.index.get(childLevel, childKey);
        if (version === undefined) return null;
        const input = await this.deps.fetchComposite(this.objectKey(childLevel, childKey, version));
        const placement: Placement = { input, left: col * cellSize, top: row * cellSize };
        return placement;
      }),
    );
    const composite = placements.filter((p): p is Placement => p !== null);
    if (composite.length === 0) return;

    const buffer = await sharp({
      create: {
        width: rawSize,
        height: rawSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite(composite)
      .resize(tileSize, tileSize)
      .avif({ quality: AVIF_QUALITY, effort: AVIF_EFFORT })
      .toBuffer();

    await this.finishBake(level, key, buffer);
  }

  // Shared tail of both bake paths above: bump the version, upload, update
  // the in-process index, persist to Redis, report completion (the caller
  // broadcasts and/or cascades to the parent level from this, see index.ts),
  // then best-effort delete the now-superseded version.
  private async finishBake(level: number, key: number, buffer: Buffer): Promise<void> {
    const previousVersion = this.deps.index.get(level, key) ?? 0;
    const version = previousVersion + 1;
    await this.deps.upload(this.objectKey(level, key, version), buffer, "image/avif");
    this.deps.index.set(level, key, version);
    await this.deps.persistVersion(level, key, version);
    this.deps.onComposited(level, key, version);

    // The old version is now dead weight, not a fallback anyone still reads:
    // every reader that could learn of this cell (index, Redis, the broadcast
    // above) already points at the new version. Best-effort: a failure here
    // is logged and leaves that one object orphaned permanently, since
    // nothing revisits a specific past version's cleanup again, unlike a
    // failed bake itself, which the next dirty mark on this (level, cell)
    // re-attempts.
    if (previousVersion > 0) {
      try {
        await this.deps.remove(this.objectKey(level, key, previousVersion));
      } catch (e) {
        console.error(
          `[cell-composite] level ${level} cell ${key} failed to delete stale v${previousVersion}`,
          (e as Error).message,
        );
      }
    }
  }

  // Level 0 keeps its existing bare shape (already live in prod, see
  // DECISIONS); only level>=1 adds an L<level> segment, so introducing the
  // pyramid never orphans an already-baked level-0 object.
  private objectKey(level: number, key: number, version: number): string {
    const base = `${this.deps.puzzleId}/cells`;
    return level === 0 ? `${base}/${key}/${version}.avif` : `${base}/L${level}/${key}/${version}.avif`;
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
// its own comment). Used only by level 0's bake: a level L>=1 bake places its
// (fixed-size) children at offsets that always fit exactly, so it never needs
// this.
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
