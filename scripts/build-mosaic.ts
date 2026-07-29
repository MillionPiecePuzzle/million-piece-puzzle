/**
 * Assemble a main image and a tile library (see `fetch-tile-images.ts`) into
 * one gigapixel photo-mosaic BigTIFF, ready for `slice-image.ts --input`.
 *
 * Each tile photo covers a `--block-size` x `--block-size` block of puzzle
 * pieces (default 4x4, i.e. a 288px stamp at the default `--piece-size 72`):
 * at true 1:1 a stamp would be a single `--piece-size`-wide square, too small
 * for a photo's subject to read as anything. `--rows`/`--cols` must both be
 * divisible by `--block-size`; the puzzle grid does not have to be square, so
 * pick `--rows`/`--cols` proportional to `--main`'s own aspect ratio (the
 * target-color resize below is a non-cropping stretch, so a mismatched ratio
 * will distort the main image).
 *
 * Algorithm: compute each tile's average CIE Lab color (cached alongside the
 * tiles), downsample `--main` to one Lab sample per cell, then for each cell
 * pick the nearest-color tile among the `--candidates` closest, preferring
 * whichever clears `--min-reuse-distance` (Chebyshev grid distance) from its
 * own last placement so the same photo doesn't cluster, falling back to the
 * single best match otherwise (never blocks). Each stamp is tinted toward its
 * cell's target color (sharp's `.tint()`, which recolors in Lab space so the
 * source photo's own luminance and texture survive) and blended against the
 * untouched original by `--blend`.
 *
 * Rendering mirrors `synthetic-source.ts`'s banded chunk/strip/BigTIFF
 * assembly so peak RAM stays bounded by one chunk rather than the whole
 * raster; chunk boundaries are snapped to cell boundaries so no stamp ever
 * straddles a chunk. `--piece-size` defaults to 72, this pipeline's validated
 * safe point below the ~6 gigapixel single-image write ceiling documented in
 * `synthetic-source.ts` (CLAUDE.md's 80px/piece target already crashes there).
 *
 * Usage:
 *   tsx scripts/build-mosaic.ts --main samples/source/blue-marble.tif \
 *     --tiles samples/tiles --out generated/mosaic.tif --rows 1000 --cols 1000
 *   tsx scripts/build-mosaic.ts --main ... --out ... --dry-run
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { mulberry32, seedFromString, subseed } from "@mpp/shared";

type Args = {
  main: string;
  tiles: string;
  out: string;
  rows: number;
  cols: number;
  pieceSize: number;
  blockSize: number;
  candidates: number;
  minReuseDistance: number;
  blend: number;
  seed: string;
  chunk: number;
  concurrency: number;
  dryRun: boolean;
};

type TileManifest = { tiles: { file: string }[] };

type ColorCacheEntry = {
  mtimeMs: number;
  size: number;
  rgb: [number, number, number];
  lab: [number, number, number];
};
type ColorCache = Record<string, ColorCacheEntry>;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseArgs(argv: string[]): Args {
  const main = flag(argv, "main");
  const out = flag(argv, "out");
  if (!main) throw new Error("missing required flag --main <file>");
  if (!out) throw new Error("missing required flag --out <file.tif>");
  const concurrencyFlag = flag(argv, "concurrency");
  return {
    main,
    tiles: flag(argv, "tiles") ?? "samples/tiles",
    out,
    rows: Number(flag(argv, "rows") ?? 1000),
    cols: Number(flag(argv, "cols") ?? 1000),
    pieceSize: Number(flag(argv, "piece-size") ?? 72),
    blockSize: Number(flag(argv, "block-size") ?? 4),
    candidates: Number(flag(argv, "candidates") ?? 16),
    minReuseDistance: Number(flag(argv, "min-reuse-distance") ?? 6),
    blend: Number(flag(argv, "blend") ?? 0.7),
    seed: flag(argv, "seed") ?? "mosaic",
    chunk: Number(flag(argv, "chunk") ?? 8192),
    concurrency: concurrencyFlag ? Number(concurrencyFlag) : Math.max(2, os.cpus().length),
    dryRun: argv.includes("--dry-run"),
  };
}

// Standard sRGB (D65) -> CIE Lab, used for perceptually meaningful color
// distance (raw RGB over-weights green).
function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const toLinear = (c: number): number => {
    const cs = c / 255;
    return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// Runs `fn(i)` for i in 0..total-1 with at most `limit` in flight.
async function forEachIndex(
  total: number,
  limit: number,
  fn: (i: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      await fn(i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, total) }, worker));
}

async function loadTiles(tilesDir: string): Promise<string[]> {
  const manifestPath = path.join(tilesDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as TileManifest;
  const files = manifest.tiles.map((t) => t.file).filter((f) => existsSync(path.join(tilesDir, f)));
  if (files.length === 0) throw new Error(`no usable tiles found in ${tilesDir}`);
  return files;
}

// Average Lab color per tile, cached in <tiles>/.color-cache.json keyed by
// filename and invalidated by mtime/size.
async function computeTileColors(tileFiles: string[], tilesDir: string): Promise<Float64Array> {
  const cachePath = path.join(tilesDir, ".color-cache.json");
  let cache: ColorCache = {};
  if (existsSync(cachePath)) cache = JSON.parse(await readFile(cachePath, "utf-8")) as ColorCache;

  const lab = new Float64Array(tileFiles.length * 3);
  let dirty = false;
  for (let i = 0; i < tileFiles.length; i++) {
    const file = tileFiles[i]!;
    const filePath = path.join(tilesDir, file);
    const st = await stat(filePath);
    const cached = cache[file];
    let entry: ColorCacheEntry;
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      entry = cached;
    } else {
      const { data } = await sharp(filePath, { limitInputPixels: false })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .toColourspace("srgb")
        .resize(1, 1, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rgb: [number, number, number] = [data[0]!, data[1]!, data[2]!];
      entry = { mtimeMs: st.mtimeMs, size: st.size, rgb, lab: srgbToLab(...rgb) };
      cache[file] = entry;
      dirty = true;
    }
    lab[i * 3] = entry.lab[0];
    lab[i * 3 + 1] = entry.lab[1];
    lab[i * 3 + 2] = entry.lab[2];
  }
  if (dirty) await writeFile(cachePath, JSON.stringify(cache));
  return lab;
}

// One Lab + RGB sample per mosaic cell, stretching the whole main image onto
// the whole cell grid with no cropping (deliberately `fill`, not `cover`).
async function computeTargetColors(
  mainPath: string,
  mosaicCols: number,
  mosaicRows: number,
): Promise<{ rgb: Buffer; lab: Float64Array }> {
  const { data } = await sharp(mainPath, { limitInputPixels: false })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .toColourspace("srgb")
    .resize(mosaicCols, mosaicRows, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const cells = mosaicCols * mosaicRows;
  const lab = new Float64Array(cells * 3);
  for (let i = 0; i < cells; i++) {
    const o = i * 3;
    const [l, a, b] = srgbToLab(data[o]!, data[o + 1]!, data[o + 2]!);
    lab[o] = l;
    lab[o + 1] = a;
    lab[o + 2] = b;
  }
  return { rgb: data, lab };
}

// For each cell (row-major), picks the tile among the `candidates` nearest by
// Lab distance that clears `minReuseDistance` (Chebyshev) from its own last
// placement, preferring whichever cleared it by the widest margin; ties (and
// the case where nothing clears it) fall back deterministically.
function selectTiles(
  mosaicRows: number,
  mosaicCols: number,
  tileLab: Float64Array,
  tileCount: number,
  targetLab: Float64Array,
  candidates: number,
  minReuseDistance: number,
  seedStr: string,
): { assignment: Int32Array; avgDeltaE: number; reuseFloorViolations: number } {
  const seedBase = seedFromString(seedStr);
  const assignment = new Int32Array(mosaicRows * mosaicCols);
  const lastRow = new Int32Array(tileCount).fill(-1);
  const lastCol = new Int32Array(tileCount).fill(-1);

  const distScratch = new Float64Array(tileCount);
  const order = new Int32Array(tileCount);
  const identity = new Int32Array(tileCount);
  for (let i = 0; i < tileCount; i++) identity[i] = i;

  const k = Math.min(candidates, tileCount);
  let deltaESum = 0;
  let reuseFloorViolations = 0;

  for (let row = 0; row < mosaicRows; row++) {
    for (let col = 0; col < mosaicCols; col++) {
      const cellIndex = row * mosaicCols + col;
      const to = cellIndex * 3;
      for (let i = 0; i < tileCount; i++) {
        const o = i * 3;
        const dl = targetLab[to]! - tileLab[o]!;
        const da = targetLab[to + 1]! - tileLab[o + 1]!;
        const db = targetLab[to + 2]! - tileLab[o + 2]!;
        distScratch[i] = dl * dl + da * da + db * db;
      }
      order.set(identity);
      order.sort((a, b) => distScratch[a]! - distScratch[b]!);

      let bestReuseDist = -1;
      let tiedBest: number[] = [];
      for (let ci = 0; ci < k; ci++) {
        const idx = order[ci]!;
        const lr = lastRow[idx]!;
        const reuseDist =
          lr < 0
            ? Number.POSITIVE_INFINITY
            : Math.max(Math.abs(row - lr), Math.abs(col - lastCol[idx]!));
        if (reuseDist < minReuseDistance) continue;
        if (reuseDist > bestReuseDist) {
          bestReuseDist = reuseDist;
          tiedBest = [idx];
        } else if (reuseDist === bestReuseDist) {
          tiedBest.push(idx);
        }
      }

      let chosen: number;
      if (tiedBest.length === 0) {
        chosen = order[0]!;
        reuseFloorViolations++;
      } else if (tiedBest.length === 1) {
        chosen = tiedBest[0]!;
      } else {
        const rand = mulberry32(subseed(seedBase, row, col));
        chosen = tiedBest[Math.floor(rand() * tiedBest.length)]!;
      }

      lastRow[chosen] = row;
      lastCol[chosen] = col;
      assignment[cellIndex] = chosen;
      deltaESum += Math.sqrt(distScratch[chosen]!);
    }
  }

  return { assignment, avgDeltaE: deltaESum / assignment.length, reuseFloorViolations };
}

// Resizes each used tile once to stamp size (cover fit), cached in memory for
// the whole render pass instead of re-decoding the same handful of files on
// every one of the many cells that reuse them.
async function buildStampCache(
  usedIndices: number[],
  tileFiles: string[],
  tilesDir: string,
  cellPx: number,
  concurrency: number,
): Promise<Map<number, Buffer>> {
  const cache = new Map<number, Buffer>();
  await forEachIndex(usedIndices.length, concurrency, async (i) => {
    const idx = usedIndices[i]!;
    const file = tileFiles[idx]!;
    const buf = await sharp(path.join(tilesDir, file), { limitInputPixels: false })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toColourspace("srgb")
      .resize(cellPx, cellPx, { fit: "cover" })
      .raw()
      .toBuffer();
    cache.set(idx, buf);
  });
  return cache;
}

async function renderChunkBuffer(
  left: number,
  top: number,
  w: number,
  h: number,
  cellPx: number,
  mosaicCols: number,
  assignment: Int32Array,
  targetRgb: Buffer,
  stampCache: Map<number, Buffer>,
  blend: number,
  concurrency: number,
): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3);
  const cellColStart = left / cellPx;
  const cellRowStart = top / cellPx;
  const cellCols = w / cellPx;
  const cellRows = h / cellPx;

  await forEachIndex(cellCols * cellRows, concurrency, async (i) => {
    const r = Math.floor(i / cellCols);
    const c = i % cellCols;
    const cellRow = cellRowStart + r;
    const cellCol = cellColStart + c;
    const cellIndex = cellRow * mosaicCols + cellCol;
    const stamp = stampCache.get(assignment[cellIndex]!)!;

    const to = cellIndex * 3;
    const tinted = await sharp(stamp, {
      raw: { width: cellPx, height: cellPx, channels: 3 },
      limitInputPixels: false,
    })
      .tint({ r: targetRgb[to]!, g: targetRgb[to + 1]!, b: targetRgb[to + 2]! })
      .raw()
      .toBuffer();

    const blended = Buffer.alloc(cellPx * cellPx * 3);
    for (let k = 0; k < blended.length; k++) {
      blended[k] = Math.round(blend * tinted[k]! + (1 - blend) * stamp[k]!);
    }

    const localLeft = c * cellPx;
    const localTop = r * cellPx;
    const rowBytes = cellPx * 3;
    for (let row = 0; row < cellPx; row++) {
      const srcStart = row * rowBytes;
      const destStart = ((localTop + row) * w + localLeft) * 3;
      blended.copy(buf, destStart, srcStart, srcStart + rowBytes);
    }
  });

  return buf;
}

const TIFF_TILE = 512;
const MAX_CHUNK = 16384;

// Banded chunk/strip/BigTIFF assembly, mirroring synthetic-source.ts's
// materializeSyntheticSource so peak RAM stays bounded by one chunk. Chunk
// size is snapped down to a whole number of cells so no stamp ever straddles
// a chunk boundary (safe because --rows/--cols are validated divisible by
// --block-size, so width/height are themselves exact multiples of cellPx).
async function renderMosaic(opts: {
  cols: number;
  rows: number;
  pieceSize: number;
  mosaicCols: number;
  cellPx: number;
  assignment: Int32Array;
  targetRgb: Buffer;
  stampCache: Map<number, Buffer>;
  blend: number;
  chunk: number;
  concurrency: number;
  outPath: string;
}): Promise<{ width: number; height: number }> {
  const {
    cols,
    rows,
    pieceSize,
    mosaicCols,
    cellPx,
    assignment,
    targetRgb,
    stampCache,
    blend,
    concurrency,
    outPath,
  } = opts;
  const width = cols * pieceSize;
  const height = rows * pieceSize;
  const cellsPerChunkAxis = Math.max(1, Math.floor(Math.min(opts.chunk, MAX_CHUNK) / cellPx));
  const chunk = cellsPerChunkAxis * cellPx;

  const tiled = { tile: true, tileWidth: TIFF_TILE, tileHeight: TIFF_TILE } as const;
  sharp.cache(false);

  await mkdir(path.dirname(outPath), { recursive: true });
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mpp-mosaic-"));
  try {
    const totalBands = Math.ceil(height / chunk);
    const strips: sharp.OverlayOptions[] = [];
    let band = 0;
    for (let top = 0; top < height; top += chunk) {
      const bandHeight = Math.min(chunk, height - top);
      const chunkFiles: sharp.OverlayOptions[] = [];
      for (let left = 0; left < width; left += chunk) {
        const w = Math.min(chunk, width - left);
        const buf = await renderChunkBuffer(
          left,
          top,
          w,
          bandHeight,
          cellPx,
          mosaicCols,
          assignment,
          targetRgb,
          stampCache,
          blend,
          concurrency,
        );
        const file = path.join(tmpDir, `chunk-${left}-${top}.tif`);
        await sharp(buf, {
          raw: { width: w, height: bandHeight, channels: 3 },
          limitInputPixels: false,
        })
          .tiff({ ...tiled, compression: "deflate" })
          .toFile(file);
        chunkFiles.push({ input: file, left, top: 0, limitInputPixels: false });
      }
      const stripFile = path.join(tmpDir, `strip-${top}.tif`);
      await sharp({
        create: { width, height: bandHeight, channels: 3, background: { r: 0, g: 0, b: 0 } },
        limitInputPixels: false,
      })
        .composite(chunkFiles)
        .tiff({ ...tiled, compression: "deflate" })
        .toFile(stripFile);
      for (const c of chunkFiles) await rm(c.input as string, { force: true }).catch(() => {});
      strips.push({ input: stripFile, left: 0, top, limitInputPixels: false });
      band++;
      console.log(`[build-mosaic] assembled strip ${band}/${totalBands}`);
    }

    await sharp({
      create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
      limitInputPixels: false,
    })
      .composite(strips)
      .tiff({ ...tiled, bigtiff: true, compression: "deflate" })
      .toFile(outPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch((err: unknown) => {
      console.warn(
        `could not remove temp dir ${tmpDir}: ${err instanceof Error ? err.message : err}`,
      );
    });
  }
  return { width, height };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.rows % args.blockSize !== 0 || args.cols % args.blockSize !== 0) {
    throw new Error(
      `--rows and --cols must both be divisible by --block-size ` +
        `(got rows=${args.rows}, cols=${args.cols}, block-size=${args.blockSize})`,
    );
  }

  const tileFiles = await loadTiles(args.tiles);
  console.log(`[build-mosaic] ${tileFiles.length} tiles available`);

  const tileLab = await computeTileColors(tileFiles, args.tiles);

  const mosaicCols = args.cols / args.blockSize;
  const mosaicRows = args.rows / args.blockSize;
  const cellPx = args.blockSize * args.pieceSize;

  const { rgb: targetRgb, lab: targetLab } = await computeTargetColors(
    args.main,
    mosaicCols,
    mosaicRows,
  );

  console.log(`[build-mosaic] selecting tiles for ${mosaicCols}x${mosaicRows} cells...`);
  const t0 = Date.now();
  const { assignment, avgDeltaE, reuseFloorViolations } = selectTiles(
    mosaicRows,
    mosaicCols,
    tileLab,
    tileFiles.length,
    targetLab,
    args.candidates,
    args.minReuseDistance,
    args.seed,
  );
  console.log(
    `[build-mosaic] selection done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ` +
      `avg dE76 ${avgDeltaE.toFixed(2)}, reuse-floor violations ${reuseFloorViolations}/${assignment.length}`,
  );

  if (args.dryRun) {
    console.log(`[build-mosaic] dry-run: stopping before render`);
    return;
  }

  const usedIndices = Array.from(new Set(assignment));
  console.log(
    `[build-mosaic] pre-caching ${usedIndices.length}/${tileFiles.length} used tiles at ${cellPx}px...`,
  );
  sharp.concurrency(1);
  const stampCache = await buildStampCache(
    usedIndices,
    tileFiles,
    args.tiles,
    cellPx,
    args.concurrency,
  );

  const width = args.cols * args.pieceSize;
  const height = args.rows * args.pieceSize;
  console.log(`[build-mosaic] rendering ${width}x${height}px to ${args.out}...`);
  const t1 = Date.now();
  const result = await renderMosaic({
    cols: args.cols,
    rows: args.rows,
    pieceSize: args.pieceSize,
    mosaicCols,
    cellPx,
    assignment,
    targetRgb,
    stampCache,
    blend: args.blend,
    chunk: args.chunk,
    concurrency: args.concurrency,
    outPath: args.out,
  });
  console.log(
    `[build-mosaic] wrote ${result.width}x${result.height} to ${args.out} in ` +
      `${((Date.now() - t1) / 1000).toFixed(1)}s`,
  );
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("build-mosaic.ts");
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
