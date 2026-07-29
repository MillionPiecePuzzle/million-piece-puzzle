/**
 * Assemble a main image and a tile library (see `fetch-tile-images.ts`) into
 * one gigapixel photo-mosaic BigTIFF, ready for `slice-image.ts --input`.
 *
 * Each tile photo covers one irregular rectangular region of puzzle pieces,
 * not a uniform square grid: `--rows`/`--cols` (in piece units) are split
 * into horizontal bands of random height in `[--min-block, --max-block]`,
 * and each band is independently split into column slices of random width in
 * the same range, so neighboring bands' seams don't line up (a running-bond,
 * brick-like offset) and stamps vary between wide, tall and square. A
 * `--border`-px `--border-color` seam is inset from every region's own edges
 * (each region draws its own half, so adjacent stamps end up with a full
 * seam between them, and the outer image edge gets a half-width frame).
 *
 * Algorithm: compute each tile's average CIE Lab color (cached alongside the
 * tiles), sample `--main` at one RGB value per piece and average that over
 * each region's footprint, then for each region pick the nearest-color tile
 * among the `--candidates` closest, preferring whichever clears
 * `--min-reuse-distance` (Chebyshev distance between region centers, in
 * piece units) from its own last placement so the same photo doesn't
 * cluster, falling back to the single best match otherwise (never blocks).
 * Each stamp is tinted toward its region's target color (sharp's `.tint()`,
 * which recolors in Lab space so the source photo's own luminance and
 * texture survive) and blended against the untouched original by `--blend`.
 *
 * Rendering mirrors `synthetic-source.ts`'s banded chunk/strip/BigTIFF
 * assembly so peak RAM stays bounded by one chunk rather than the whole
 * raster: each band is rendered as its own strip (a band's regions never
 * span more than one strip since a band's own split created them), and
 * within a band, column slices are grouped into chunks bounded by `--chunk`,
 * cut only at slice boundaries so no stamp ever straddles a chunk. Each used
 * tile is decoded and downscaled once (`fit: "inside"`, no premature crop)
 * and cached in memory; only that cached buffer is re-resized per region.
 * `--piece-size` defaults to 72, this pipeline's validated safe point below
 * the ~6 gigapixel single-image write ceiling documented in
 * `synthetic-source.ts` (CLAUDE.md's 80px/piece target already crashes
 * there).
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

type Rgb = { r: number; g: number; b: number };

type Args = {
  main: string;
  tiles: string;
  out: string;
  rows: number;
  cols: number;
  pieceSize: number;
  minBlock: number;
  maxBlock: number;
  border: number;
  borderColor: Rgb;
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

// A rectangular tile region, in piece-grid units. `id` is its index in the
// flat region list (band order, then left-to-right within the band); every
// per-region array (assignment, colors) is indexed by it.
type Region = { id: number; col: number; row: number; w: number; h: number };
type Band = { row: number; h: number; regions: Region[] };

type CachedStamp = { buf: Buffer; width: number; height: number };

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseHexColor(hex: string): Rgb {
  const clean = hex.replace(/^#/, "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
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
    minBlock: Number(flag(argv, "min-block") ?? 3),
    maxBlock: Number(flag(argv, "max-block") ?? 6),
    border: Number(flag(argv, "border") ?? 3),
    borderColor: parseHexColor(flag(argv, "border-color") ?? "#161616"),
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

// Splits `total` into a sequence of positive integer lengths, each in
// [min, max], summing to exactly `total`. The last piece may fall outside
// that range by a small, bounded amount when the remainder doesn't divide
// evenly (merged into the previous piece rather than emitted as a sliver).
function splitLengths(total: number, min: number, max: number, rng: () => number): number[] {
  const lengths: number[] = [];
  let remaining = total;
  while (remaining > 0) {
    if (remaining <= max) {
      if (remaining < min && lengths.length > 0) {
        lengths[lengths.length - 1] += remaining;
      } else {
        lengths.push(remaining);
      }
      remaining = 0;
    } else {
      const maxTake = Math.min(max, remaining - min);
      const take = maxTake < min ? remaining : min + Math.floor(rng() * (maxTake - min + 1));
      lengths.push(take);
      remaining -= take;
    }
  }
  return lengths;
}

// Splits the whole rows x cols piece grid into horizontal bands of random
// height, each independently split into column slices of random width, so
// seams between bands don't line up (a brick-like running-bond offset).
function partitionBands(
  cols: number,
  rows: number,
  minBlock: number,
  maxBlock: number,
  rng: () => number,
): Band[] {
  const bandHeights = splitLengths(rows, minBlock, maxBlock, rng);
  const bands: Band[] = [];
  let row = 0;
  let nextId = 0;
  for (const h of bandHeights) {
    const colWidths = splitLengths(cols, minBlock, maxBlock, rng);
    const regions: Region[] = [];
    let col = 0;
    for (const w of colWidths) {
      regions.push({ id: nextId++, col, row, w, h });
      col += w;
    }
    bands.push({ row, h, regions });
    row += h;
  }
  return bands;
}

// One RGB sample per piece, stretching the whole main image onto the whole
// piece grid with no cropping (deliberately `fill`, not `cover`).
async function computeMainImagePieceRgb(
  mainPath: string,
  cols: number,
  rows: number,
): Promise<Buffer> {
  const { data } = await sharp(mainPath, { limitInputPixels: false })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .toColourspace("srgb")
    .resize(cols, rows, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

// Averages the per-piece RGB samples over each region's own footprint.
function computeRegionColors(
  regions: Region[],
  cols: number,
  pieceRgb: Buffer,
): { rgb: Float64Array; lab: Float64Array } {
  const rgb = new Float64Array(regions.length * 3);
  const lab = new Float64Array(regions.length * 3);
  for (const region of regions) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let dy = 0; dy < region.h; dy++) {
      const rowBase = ((region.row + dy) * cols + region.col) * 3;
      for (let dx = 0; dx < region.w; dx++) {
        const o = rowBase + dx * 3;
        sr += pieceRgb[o]!;
        sg += pieceRgb[o + 1]!;
        sb += pieceRgb[o + 2]!;
      }
    }
    const n = region.w * region.h;
    const avgR = sr / n;
    const avgG = sg / n;
    const avgB = sb / n;
    const o = region.id * 3;
    rgb[o] = avgR;
    rgb[o + 1] = avgG;
    rgb[o + 2] = avgB;
    const [l, a, b] = srgbToLab(avgR, avgG, avgB);
    lab[o] = l;
    lab[o + 1] = a;
    lab[o + 2] = b;
  }
  return { rgb, lab };
}

// For each region, picks the tile among the `candidates` nearest by Lab
// distance that clears `minReuseDistance` (Chebyshev, between region
// centers in piece units) from its own last placement, preferring whichever
// cleared it by the widest margin; ties (and the case where nothing clears
// it) fall back deterministically.
function selectTiles(
  regions: Region[],
  tileLab: Float64Array,
  tileCount: number,
  regionLab: Float64Array,
  candidates: number,
  minReuseDistance: number,
  seedStr: string,
): { assignment: Int32Array; avgDeltaE: number; reuseFloorViolations: number } {
  const seedBase = seedFromString(seedStr);
  const assignment = new Int32Array(regions.length);
  const lastCenterRow = new Float64Array(tileCount).fill(-Infinity);
  const lastCenterCol = new Float64Array(tileCount).fill(-Infinity);

  const distScratch = new Float64Array(tileCount);
  const order = new Int32Array(tileCount);
  const identity = new Int32Array(tileCount);
  for (let i = 0; i < tileCount; i++) identity[i] = i;

  const k = Math.min(candidates, tileCount);
  let deltaESum = 0;
  let reuseFloorViolations = 0;

  for (const region of regions) {
    const centerRow = region.row + region.h / 2;
    const centerCol = region.col + region.w / 2;
    const to = region.id * 3;
    for (let i = 0; i < tileCount; i++) {
      const o = i * 3;
      const dl = regionLab[to]! - tileLab[o]!;
      const da = regionLab[to + 1]! - tileLab[o + 1]!;
      const db = regionLab[to + 2]! - tileLab[o + 2]!;
      distScratch[i] = dl * dl + da * da + db * db;
    }
    order.set(identity);
    order.sort((a, b) => distScratch[a]! - distScratch[b]!);

    let bestReuseDist = -1;
    let tiedBest: number[] = [];
    for (let ci = 0; ci < k; ci++) {
      const idx = order[ci]!;
      const reuseDist = Math.max(
        Math.abs(centerRow - lastCenterRow[idx]!),
        Math.abs(centerCol - lastCenterCol[idx]!),
      );
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
      const rand = mulberry32(subseed(seedBase, region.row, region.col));
      chosen = tiedBest[Math.floor(rand() * tiedBest.length)]!;
    }

    lastCenterRow[chosen] = centerRow;
    lastCenterCol[chosen] = centerCol;
    assignment[region.id] = chosen;
    deltaESum += Math.sqrt(distScratch[chosen]!);
  }

  return { assignment, avgDeltaE: deltaESum / regions.length, reuseFloorViolations };
}

// Decodes and downscales each used tile once (`fit: "inside"`, so the whole
// photo is kept, nothing pre-cropped), cached in memory for the whole render
// pass at whatever aspect ratio the source has. Each region later resizes
// from this cached buffer (cheap, no re-decode) to its own exact size.
async function buildStampCache(
  usedIndices: number[],
  tileFiles: string[],
  tilesDir: string,
  maxStampPx: number,
  concurrency: number,
): Promise<Map<number, CachedStamp>> {
  const cache = new Map<number, CachedStamp>();
  await forEachIndex(usedIndices.length, concurrency, async (i) => {
    const idx = usedIndices[i]!;
    const file = tileFiles[idx]!;
    const { data, info } = await sharp(path.join(tilesDir, file), { limitInputPixels: false })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toColourspace("srgb")
      .resize(maxStampPx, maxStampPx, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    cache.set(idx, { buf: data, width: info.width, height: info.height });
  });
  return cache;
}

// Groups consecutive lengths (already in pixels) into chunks whose running
// total doesn't exceed `target`, so a chunk boundary always falls between
// two regions, never inside one.
function groupIntoChunks(lengthsPx: number[], target: number): number[][] {
  const groups: number[][] = [];
  let current: number[] = [];
  let currentSum = 0;
  for (let i = 0; i < lengthsPx.length; i++) {
    const len = lengthsPx[i]!;
    if (current.length > 0 && currentSum + len > target) {
      groups.push(current);
      current = [];
      currentSum = 0;
    }
    current.push(i);
    currentSum += len;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// Renders one band's column-chunk: every region in it shares the band's
// full height, so each only varies in horizontal position and width. Each
// region draws a `border`-px seam inset from its own edges before the
// tinted, blended stamp fills the remaining inner rectangle.
async function renderBandChunk(
  regions: Region[],
  chunkLeftPx: number,
  chunkWidthPx: number,
  bandHeightPx: number,
  pieceSize: number,
  border: number,
  borderColor: Rgb,
  assignment: Int32Array,
  targetRgb: Float64Array,
  stampCache: Map<number, CachedStamp>,
  blend: number,
  concurrency: number,
): Promise<Buffer> {
  const buf = Buffer.alloc(chunkWidthPx * bandHeightPx * 3);
  for (let p = 0; p < buf.length; p += 3) {
    buf[p] = borderColor.r;
    buf[p + 1] = borderColor.g;
    buf[p + 2] = borderColor.b;
  }

  await forEachIndex(regions.length, concurrency, async (i) => {
    const region = regions[i]!;
    const regionLeftPx = region.col * pieceSize - chunkLeftPx;
    const regionWPx = region.w * pieceSize;
    const regionHPx = region.h * pieceSize;

    const b = Math.max(0, Math.min(border, Math.floor(Math.min(regionWPx, regionHPx) / 2) - 1));
    const innerWPx = regionWPx - 2 * b;
    const innerHPx = regionHPx - 2 * b;

    const tileIdx = assignment[region.id]!;
    const stamp = stampCache.get(tileIdx)!;
    const to = region.id * 3;

    const resizedOriginal = await sharp(stamp.buf, {
      raw: { width: stamp.width, height: stamp.height, channels: 3 },
      limitInputPixels: false,
    })
      .resize(innerWPx, innerHPx, { fit: "cover" })
      .raw()
      .toBuffer();

    const tinted = await sharp(resizedOriginal, {
      raw: { width: innerWPx, height: innerHPx, channels: 3 },
      limitInputPixels: false,
    })
      .tint({ r: targetRgb[to]!, g: targetRgb[to + 1]!, b: targetRgb[to + 2]! })
      .raw()
      .toBuffer();

    const blended = Buffer.alloc(innerWPx * innerHPx * 3);
    for (let k = 0; k < blended.length; k++) {
      blended[k] = Math.round(blend * tinted[k]! + (1 - blend) * resizedOriginal[k]!);
    }

    const destLeft = regionLeftPx + b;
    const destTop = b;
    const rowBytes = innerWPx * 3;
    for (let row = 0; row < innerHPx; row++) {
      const srcStart = row * rowBytes;
      const destStart = ((destTop + row) * chunkWidthPx + destLeft) * 3;
      blended.copy(buf, destStart, srcStart, srcStart + rowBytes);
    }
  });

  return buf;
}

const TIFF_TILE = 512;
const MAX_CHUNK = 16384;

// Banded chunk/strip/BigTIFF assembly, mirroring synthetic-source.ts's
// materializeSyntheticSource so peak RAM stays bounded by one chunk rather
// than the whole raster. Each band is its own strip (bands already never
// contain a region taller than themselves); within a band, column slices
// are grouped into chunks bounded by --chunk, cut only at slice boundaries.
async function renderMosaic(opts: {
  cols: number;
  rows: number;
  pieceSize: number;
  bands: Band[];
  assignment: Int32Array;
  targetRgb: Float64Array;
  stampCache: Map<number, CachedStamp>;
  blend: number;
  border: number;
  borderColor: Rgb;
  chunk: number;
  concurrency: number;
  outPath: string;
}): Promise<{ width: number; height: number }> {
  const {
    cols,
    rows,
    pieceSize,
    bands,
    assignment,
    targetRgb,
    stampCache,
    blend,
    border,
    borderColor,
    concurrency,
    outPath,
  } = opts;
  const width = cols * pieceSize;
  const height = rows * pieceSize;
  const targetChunkPx = Math.min(opts.chunk, MAX_CHUNK);

  const tiled = { tile: true, tileWidth: TIFF_TILE, tileHeight: TIFF_TILE } as const;
  sharp.cache(false);

  await mkdir(path.dirname(outPath), { recursive: true });
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mpp-mosaic-"));
  try {
    const strips: sharp.OverlayOptions[] = [];
    for (let bandIdx = 0; bandIdx < bands.length; bandIdx++) {
      const band = bands[bandIdx]!;
      const bandTopPx = band.row * pieceSize;
      const bandHeightPx = band.h * pieceSize;
      const widthsPx = band.regions.map((r) => r.w * pieceSize);
      const groups = groupIntoChunks(widthsPx, targetChunkPx);

      const chunkFiles: sharp.OverlayOptions[] = [];
      for (const group of groups) {
        const chunkRegions = group.map((idx) => band.regions[idx]!);
        const chunkLeftPx = chunkRegions[0]!.col * pieceSize;
        const chunkWidthPx = chunkRegions.reduce((s, r) => s + r.w * pieceSize, 0);

        const buf = await renderBandChunk(
          chunkRegions,
          chunkLeftPx,
          chunkWidthPx,
          bandHeightPx,
          pieceSize,
          border,
          borderColor,
          assignment,
          targetRgb,
          stampCache,
          blend,
          concurrency,
        );
        const file = path.join(tmpDir, `chunk-${bandIdx}-${chunkLeftPx}.tif`);
        await sharp(buf, {
          raw: { width: chunkWidthPx, height: bandHeightPx, channels: 3 },
          limitInputPixels: false,
        })
          .tiff({ ...tiled, compression: "deflate" })
          .toFile(file);
        chunkFiles.push({ input: file, left: chunkLeftPx, top: 0, limitInputPixels: false });
      }

      const stripFile = path.join(tmpDir, `strip-${bandIdx}.tif`);
      await sharp({
        create: { width, height: bandHeightPx, channels: 3, background: borderColor },
        limitInputPixels: false,
      })
        .composite(chunkFiles)
        .tiff({ ...tiled, compression: "deflate" })
        .toFile(stripFile);
      for (const c of chunkFiles) await rm(c.input as string, { force: true }).catch(() => {});
      strips.push({ input: stripFile, left: 0, top: bandTopPx, limitInputPixels: false });
      console.log(`[build-mosaic] assembled band ${bandIdx + 1}/${bands.length}`);
    }

    await sharp({
      create: { width, height, channels: 3, background: borderColor },
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
  if (args.minBlock < 1 || args.maxBlock < args.minBlock) {
    throw new Error(
      `--min-block must be >= 1 and --max-block must be >= --min-block ` +
        `(got min-block=${args.minBlock}, max-block=${args.maxBlock})`,
    );
  }

  const tileFiles = await loadTiles(args.tiles);
  console.log(`[build-mosaic] ${tileFiles.length} tiles available`);

  const tileLab = await computeTileColors(tileFiles, args.tiles);

  const rng = mulberry32(seedFromString(`${args.seed}:layout`));
  const bands = partitionBands(args.cols, args.rows, args.minBlock, args.maxBlock, rng);
  const regions = bands.flatMap((b) => b.regions);
  const regionSizes = regions.map((r) => Math.max(r.w, r.h));
  console.log(
    `[build-mosaic] ${regions.length} regions across ${bands.length} bands ` +
      `(largest side ${Math.min(...regionSizes)}-${Math.max(...regionSizes)} pieces)`,
  );

  const pieceRgb = await computeMainImagePieceRgb(args.main, args.cols, args.rows);
  const { rgb: targetRgb, lab: targetLab } = computeRegionColors(regions, args.cols, pieceRgb);

  console.log(`[build-mosaic] selecting tiles for ${regions.length} regions...`);
  const t0 = Date.now();
  const { assignment, avgDeltaE, reuseFloorViolations } = selectTiles(
    regions,
    tileLab,
    tileFiles.length,
    targetLab,
    args.candidates,
    args.minReuseDistance,
    args.seed,
  );
  console.log(
    `[build-mosaic] selection done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ` +
      `avg dE76 ${avgDeltaE.toFixed(2)}, reuse-floor violations ${reuseFloorViolations}/${regions.length}`,
  );

  if (args.dryRun) {
    console.log(`[build-mosaic] dry-run: stopping before render`);
    return;
  }

  const usedIndices = Array.from(new Set(assignment));
  const maxStampPx = args.maxBlock * args.pieceSize;
  console.log(
    `[build-mosaic] pre-caching ${usedIndices.length}/${tileFiles.length} used tiles (max ${maxStampPx}px)...`,
  );
  sharp.concurrency(1);
  const stampCache = await buildStampCache(
    usedIndices,
    tileFiles,
    args.tiles,
    maxStampPx,
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
    bands,
    assignment,
    targetRgb,
    stampCache,
    blend: args.blend,
    border: args.border,
    borderColor: args.borderColor,
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
