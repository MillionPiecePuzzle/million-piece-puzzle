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
 * each region's footprint, then assign each region the nearest-color tile
 * that hasn't already been used elsewhere in the mosaic: no tile photo ever
 * repeats, anywhere. This requires at least as many tiles as regions; the
 * script fails fast up front (before any expensive color decode) if short,
 * naming exactly how many more `fetch-tile-images.ts` needs to fetch. Each
 * stamp is tinted toward its region's target color (sharp's `.tint()`,
 * which recolors in Lab space so the source photo's own luminance and
 * texture survive) and blended against the untouched original by `--blend`.
 *
 * Tile selection also carries a "flatness" penalty derived from each tile's
 * cached near-black pixel fraction: a photo that's mostly empty black space
 * around one small bright subject (a planet or the Moon against the sky)
 * reads as flat once stamped down at region size, tint or no tint. Such a
 * tile is only chosen when it is clearly the best color match for a region
 * (deep-space-black regions of `--main` still need one), and a second,
 * stronger penalty discourages a region from picking one when an
 * already-decided neighboring region did too, so flat tiles that do get used
 * end up scattered rather than clumped.
 *
 * Rendering mirrors `synthetic-source.ts`'s banded chunk/strip/BigTIFF
 * assembly so peak RAM stays bounded by one chunk rather than the whole
 * raster: each band is rendered as its own strip (a band's regions never
 * span more than one strip since a band's own split created them), and
 * within a band, column slices are grouped into chunks bounded by `--chunk`,
 * cut only at slice boundaries so no stamp ever straddles a chunk. Each
 * region's tile is decoded straight from disk to that region's exact pixel
 * size (`fit: "cover"`): `selectTiles` never assigns one tile to two regions,
 * so there is no reuse to cache and pre-decoding the whole used set ahead of
 * rendering only holds gigabytes of redundant buffers in RAM for no benefit.
 *
 * `--piece-size` defaults to 72. This Windows libvips build's actual
 * single-image write ceiling sits far below the "~6 gigapixel" figure
 * documented in `synthetic-source.ts` (that number predates a libvips
 * upgrade) and is not even reliably a pure pixel-count ceiling: a plain
 * blank write starts segfaulting somewhere around 71000x71000px
 * (~5.0 gigapixels), and a many-file composite can throw a different error
 * below that same size. A real production run at a meaningful `--piece-size`
 * should run under Linux (e.g. this repo's Docker), where the identical
 * sharp/libvips version writes 14+ gigapixel images cleanly. See DECISIONS.
 *
 * Optional final correction: `--global-tint` (0-1, default 0 = off) blends
 * every chunk's finished buffer against a same-region crop of `--main`
 * itself, at that opacity. Unlike the per-region tint (one flat color per
 * stamp), this is spatially varying: it nudges each pixel toward the real
 * source photo's own local color, so a region whose only available tiles
 * are a poor color match still reads closer to the source overall. `--main`
 * is decoded once, at its own resolution, and every chunk's crop comes from
 * that single cached buffer (cheap: a small extract + resize, not a re-read
 * of the source file).
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
import { mulberry32, seedFromString } from "@mpp/shared";

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
  blend: number;
  globalTint: number;
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
  blackFrac: number;
};
type ColorCache = Record<string, ColorCacheEntry>;

// A rectangular tile region, in piece-grid units. `id` is its index in the
// flat region list (band order, then left-to-right within the band); every
// per-region array (assignment, colors) is indexed by it.
type Region = { id: number; col: number; row: number; w: number; h: number };
type Band = { row: number; h: number; regions: Region[] };

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
    border: Number(flag(argv, "border") ?? 1),
    borderColor: parseHexColor(flag(argv, "border-color") ?? "#161616"),
    blend: Number(flag(argv, "blend") ?? 0.7),
    globalTint: Number(flag(argv, "global-tint") ?? 0),
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

const FLAT_SAMPLE = 32;
const FLAT_BLACK_LUMA_THRESHOLD = 25;

// Fraction of near-black pixels in a small downsample of the tile. High for
// a photo that's mostly empty black space around one small bright subject
// (a planet or the Moon against the sky), the flat look that tinting can't
// fix; low for a normally-lit, textured photo even if its overall tone is
// dark. A separate decode from the color average below, deliberately: this
// keeps the existing, already-tuned color-match numbers from shifting as a
// side effect of adding this signal.
async function computeBlackFraction(filePath: string): Promise<number> {
  const { data, info } = await sharp(filePath, { limitInputPixels: false })
    .resize(FLAT_SAMPLE, FLAT_SAMPLE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const total = info.width * info.height;
  let dark = 0;
  for (let i = 0; i < total; i++) {
    const o = i * channels;
    const luma = 0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!;
    if (luma < FLAT_BLACK_LUMA_THRESHOLD) dark++;
  }
  return dark / total;
}

const CACHE_FLUSH_INTERVAL = 500;
const PROGRESS_LOG_INTERVAL = 500;

// Average Lab color and black-pixel fraction per tile, cached in
// <tiles>/.color-cache.json keyed by filename and invalidated by mtime/size
// (or by a cache entry predating the blackFrac field). Decodes run
// `concurrency`-wide, same as the tile rendering pass below: sequential
// decoding of a 10k+-tile library is the slow path, easily minutes long on a
// cold cache. Progress logs and periodic cache flushes make a long first-time
// run observable and mean an interruption doesn't lose everything already
// decoded.
async function computeTileColors(
  tileFiles: string[],
  tilesDir: string,
  concurrency: number,
): Promise<{ lab: Float64Array; blackFrac: Float64Array }> {
  const cachePath = path.join(tilesDir, ".color-cache.json");
  let cache: ColorCache = {};
  if (existsSync(cachePath)) cache = JSON.parse(await readFile(cachePath, "utf-8")) as ColorCache;

  const lab = new Float64Array(tileFiles.length * 3);
  const blackFrac = new Float64Array(tileFiles.length);
  let dirty = false;
  let computed = 0;
  let done = 0;
  const t0 = Date.now();

  await forEachIndex(tileFiles.length, concurrency, async (i) => {
    const file = tileFiles[i]!;
    const filePath = path.join(tilesDir, file);
    const st = await stat(filePath);
    const cached = cache[file];
    let entry: ColorCacheEntry;
    if (
      cached &&
      cached.mtimeMs === st.mtimeMs &&
      cached.size === st.size &&
      cached.blackFrac !== undefined
    ) {
      entry = cached;
    } else {
      const { data } = await sharp(filePath, { limitInputPixels: false })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .toColourspace("srgb")
        .resize(1, 1, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const rgb: [number, number, number] = [data[0]!, data[1]!, data[2]!];
      entry = {
        mtimeMs: st.mtimeMs,
        size: st.size,
        rgb,
        lab: srgbToLab(...rgb),
        blackFrac: await computeBlackFraction(filePath),
      };
      cache[file] = entry;
      dirty = true;
      computed++;
      if (computed % CACHE_FLUSH_INTERVAL === 0) await writeFile(cachePath, JSON.stringify(cache));
    }
    lab[i * 3] = entry.lab[0];
    lab[i * 3 + 1] = entry.lab[1];
    lab[i * 3 + 2] = entry.lab[2];
    blackFrac[i] = entry.blackFrac;

    done++;
    if (done % PROGRESS_LOG_INTERVAL === 0 || done === tileFiles.length) {
      const elapsed = (Date.now() - t0) / 1000;
      console.log(
        `[build-mosaic] tile analysis: ${done}/${tileFiles.length} ` +
          `(${computed} newly decoded) in ${elapsed.toFixed(0)}s`,
      );
    }
  });

  if (dirty) await writeFile(cachePath, JSON.stringify(cache));
  return { lab, blackFrac };
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

// Which regions border which, exact despite the irregular running-bond
// partition: paints each region's id into a per-piece grid, then for every
// region reads the ring of grid cells just outside its own rectangle.
function computeRegionNeighbors(bands: Band[], cols: number, rows: number): number[][] {
  const grid = new Int32Array(cols * rows).fill(-1);
  for (const band of bands) {
    for (const region of band.regions) {
      for (let dy = 0; dy < region.h; dy++) {
        const rowBase = (region.row + dy) * cols;
        for (let dx = 0; dx < region.w; dx++) grid[rowBase + region.col + dx] = region.id;
      }
    }
  }

  const neighbors: number[][] = bands.flatMap((b) => b.regions).map(() => []);
  for (const band of bands) {
    for (const region of band.regions) {
      const seen = new Set<number>();
      const top = region.row - 1;
      const bottom = region.row + region.h;
      const left = region.col - 1;
      const right = region.col + region.w;
      for (const r of [top, bottom]) {
        if (r < 0 || r >= rows) continue;
        for (let c = Math.max(0, left + 1); c < Math.min(cols, right); c++) {
          const id = grid[r * cols + c]!;
          if (id >= 0 && id !== region.id) seen.add(id);
        }
      }
      for (const c of [left, right]) {
        if (c < 0 || c >= cols) continue;
        for (let r = Math.max(0, top + 1); r < Math.min(rows, bottom); r++) {
          const id = grid[r * cols + c]!;
          if (id >= 0 && id !== region.id) seen.add(id);
        }
      }
      neighbors[region.id] = [...seen];
    }
  }
  return neighbors;
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

type MainImageRgb = { buf: Buffer; width: number; height: number };

// Decodes --main once, at its own resolution, for the optional global-tint
// pass: every chunk crops from this single cached buffer instead of
// re-reading the source file per chunk.
async function loadMainImageRgb(mainPath: string): Promise<MainImageRgb> {
  const { data, info } = await sharp(mainPath, { limitInputPixels: false })
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { buf: data, width: info.width, height: info.height };
}

// Crops the region of --main (proportionally, in its own resolution)
// corresponding to one chunk's place in the full output, then resizes that
// small crop up to the chunk's exact pixel size.
async function cropMainImage(
  main: MainImageRgb,
  fullWidth: number,
  fullHeight: number,
  left: number,
  top: number,
  w: number,
  h: number,
): Promise<Buffer> {
  const srcLeft = Math.floor((left / fullWidth) * main.width);
  const srcTop = Math.floor((top / fullHeight) * main.height);
  const srcRight = Math.ceil(((left + w) / fullWidth) * main.width);
  const srcBottom = Math.ceil(((top + h) / fullHeight) * main.height);
  const srcW = Math.max(1, Math.min(main.width - srcLeft, srcRight - srcLeft));
  const srcH = Math.max(1, Math.min(main.height - srcTop, srcBottom - srcTop));

  return sharp(main.buf, {
    raw: { width: main.width, height: main.height, channels: 3 },
    limitInputPixels: false,
  })
    .extract({ left: srcLeft, top: srcTop, width: srcW, height: srcH })
    .resize(w, h, { fit: "fill" })
    .raw()
    .toBuffer();
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

// A tile this flat (mostly empty black space, see computeBlackFraction)
// counts as a "flat tile" for the selection penalties below.
const FLAT_BLACK_FRACTION_THRESHOLD = 0.5;
// Added to a flat tile's squared-Lab score: ~15 dE76, eyeballed so it loses
// to a reasonably close non-flat alternative but still wins where nothing
// else is a good match (a genuinely near-black region).
const FLAT_PENALTY = 225;
// Extra penalty stacked on top when an already-decided neighboring region
// also landed on a flat tile (~34.6 dE76 extra): strong enough that two flat
// tiles end up adjacent only when the library has no reasonable alternative
// for either spot.
const FLAT_ADJACENT_PENALTY = 1200;

// Assigns each region a distinct tile, never repeated anywhere else in the
// mosaic: for each region (in order), walks tiles by a score (Lab distance,
// plus the flatness penalties above) and takes the first unclaimed one that
// minimizes it. Requires regions.length <= tileCount; the caller checks that
// before this runs, so a not-yet-used tile always exists (fewer regions
// processed so far than total tiles). Regions are processed band-by-band,
// left-to-right, so by the time a region is decided every neighbor that
// precedes it in that order is already decided, and `regionNeighbors` lets
// each region see whether one of those already picked a flat tile.
function selectTiles(
  regions: Region[],
  tileLab: Float64Array,
  tileBlackFrac: Float64Array,
  tileCount: number,
  regionLab: Float64Array,
  regionNeighbors: number[][],
): { assignment: Int32Array; avgDeltaE: number; flatUsed: number } {
  const assignment = new Int32Array(regions.length);
  const used = new Uint8Array(tileCount);
  const isFlatTile = new Uint8Array(tileCount);
  for (let i = 0; i < tileCount; i++) {
    isFlatTile[i] = tileBlackFrac[i]! > FLAT_BLACK_FRACTION_THRESHOLD ? 1 : 0;
  }
  const regionIsFlat = new Uint8Array(regions.length);

  const distScratch = new Float64Array(tileCount);
  const scoreScratch = new Float64Array(tileCount);
  const order = new Int32Array(tileCount);
  const identity = new Int32Array(tileCount);
  for (let i = 0; i < tileCount; i++) identity[i] = i;

  let deltaESum = 0;
  let flatUsed = 0;

  for (const region of regions) {
    const to = region.id * 3;
    const neighborHasFlat = regionNeighbors[region.id]!.some((nid) => regionIsFlat[nid]);
    for (let i = 0; i < tileCount; i++) {
      const o = i * 3;
      const dl = regionLab[to]! - tileLab[o]!;
      const da = regionLab[to + 1]! - tileLab[o + 1]!;
      const db = regionLab[to + 2]! - tileLab[o + 2]!;
      const dist = dl * dl + da * da + db * db;
      distScratch[i] = dist;
      scoreScratch[i] =
        dist + (isFlatTile[i] ? FLAT_PENALTY + (neighborHasFlat ? FLAT_ADJACENT_PENALTY : 0) : 0);
    }
    order.set(identity);
    order.sort((a, b) => scoreScratch[a]! - scoreScratch[b]!);

    let chosen = -1;
    for (let ci = 0; ci < tileCount; ci++) {
      const idx = order[ci]!;
      if (!used[idx]) {
        chosen = idx;
        break;
      }
    }

    used[chosen] = 1;
    assignment[region.id] = chosen;
    regionIsFlat[region.id] = isFlatTile[chosen]!;
    if (isFlatTile[chosen]) flatUsed++;
    deltaESum += Math.sqrt(distScratch[chosen]!);
  }

  return { assignment, avgDeltaE: deltaESum / regions.length, flatUsed };
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

type PositionedFile = { file: string; top: number; height: number };

// Merges vertically-stacked strip files into one output, bounding how many
// real inputs any single libvips composite call handles at once: compositing
// every strip in one call peaks far past what a modest machine has free once
// there are dozens of large real (not blank) tiled inputs, so groups of at
// most `branch` are merged into intermediate files first, recursively, until
// only `branch`-or-fewer remain for the final composite. Each input file is
// removed once consumed by its merge, so temp usage never holds more than
// roughly one level's worth of intermediates at a time.
async function mergeStrips(
  items: PositionedFile[],
  width: number,
  borderColor: Rgb,
  tiled: { tile: true; tileWidth: number; tileHeight: number },
  outPath: string,
  tmpDir: string,
  branch: number,
  level: number,
): Promise<void> {
  if (items.length <= branch) {
    const height = items.reduce((max, it) => Math.max(max, it.top + it.height), 0);
    await sharp({
      create: { width, height, channels: 3, background: borderColor },
      limitInputPixels: false,
    })
      .composite(items.map((it) => ({ input: it.file, left: 0, top: it.top, limitInputPixels: false })))
      .tiff({ ...tiled, bigtiff: true, compression: "deflate" })
      .toFile(outPath);
    for (const it of items) await rm(it.file, { force: true }).catch(() => {});
    return;
  }

  const nextLevel: PositionedFile[] = [];
  for (let i = 0; i < items.length; i += branch) {
    const group = items.slice(i, i + branch);
    const groupTop = group[0]!.top;
    const groupHeight = group.reduce((s, it) => s + it.height, 0);
    const mergedFile = path.join(tmpDir, `merge-${level}-${groupTop}.tif`);
    await sharp({
      create: { width, height: groupHeight, channels: 3, background: borderColor },
      limitInputPixels: false,
    })
      .composite(
        group.map((it) => ({ input: it.file, left: 0, top: it.top - groupTop, limitInputPixels: false })),
      )
      // bigtiff even for an intermediate: later merge levels keep stacking
      // these, and classic TIFF's 4GB file-size ceiling is easy to cross
      // well before the final output does.
      .tiff({ ...tiled, bigtiff: true, compression: "deflate" })
      .toFile(mergedFile);
    for (const it of group) await rm(it.file, { force: true }).catch(() => {});
    nextLevel.push({ file: mergedFile, top: groupTop, height: groupHeight });
  }
  console.log(`[build-mosaic] merge level ${level}: ${items.length} -> ${nextLevel.length} files`);
  await mergeStrips(nextLevel, width, borderColor, tiled, outPath, tmpDir, branch, level + 1);
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
  tileFiles: string[],
  tilesDir: string,
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
    const to = region.id * 3;

    // Each tile index is assigned to exactly one region (selectTiles never
    // repeats one), so there is nothing to gain from caching a decode across
    // calls: decode straight to this region's exact size.
    const resizedOriginal = await sharp(path.join(tilesDir, tileFiles[tileIdx]!), {
      limitInputPixels: false,
    })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toColourspace("srgb")
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
  tileFiles: string[];
  tilesDir: string;
  blend: number;
  border: number;
  borderColor: Rgb;
  globalTint: number;
  mainRgb?: MainImageRgb;
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
    tileFiles,
    tilesDir,
    blend,
    border,
    borderColor,
    globalTint,
    mainRgb,
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
    const strips: PositionedFile[] = [];
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
          tileFiles,
          tilesDir,
          blend,
          concurrency,
        );

        if (globalTint > 0) {
          const mainCrop = await cropMainImage(
            mainRgb!,
            width,
            height,
            chunkLeftPx,
            bandTopPx,
            chunkWidthPx,
            bandHeightPx,
          );
          for (let k = 0; k < buf.length; k++) {
            buf[k] = Math.round((1 - globalTint) * buf[k]! + globalTint * mainCrop[k]!);
          }
        }

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
      strips.push({ file: stripFile, top: bandTopPx, height: bandHeightPx });
      console.log(`[build-mosaic] assembled band ${bandIdx + 1}/${bands.length}`);
    }

    console.log(`[build-mosaic] merging ${strips.length} strips into ${outPath}...`);
    await mergeStrips(strips, width, borderColor, tiled, outPath, tmpDir, 4, 0);
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

  const rng = mulberry32(seedFromString(`${args.seed}:layout`));
  const bands = partitionBands(args.cols, args.rows, args.minBlock, args.maxBlock, rng);
  const regions = bands.flatMap((b) => b.regions);
  const regionSizes = regions.map((r) => Math.max(r.w, r.h));
  console.log(
    `[build-mosaic] ${regions.length} regions across ${bands.length} bands ` +
      `(largest side ${Math.min(...regionSizes)}-${Math.max(...regionSizes)} pieces)`,
  );

  if (regions.length > tileFiles.length) {
    const short = regions.length - tileFiles.length;
    throw new Error(
      `not enough tiles for a repeat-free mosaic: ${regions.length} regions each need a distinct ` +
        `tile, only ${tileFiles.length} available (short by ${short}). Fetch more first, e.g. ` +
        `npm run fetch:tiles -- --count ${tileFiles.length + short + 50}, or widen ` +
        `--min-block/--max-block to produce fewer, larger regions.`,
    );
  }

  const { lab: tileLab, blackFrac: tileBlackFrac } = await computeTileColors(
    tileFiles,
    args.tiles,
    args.concurrency,
  );
  const pieceRgb = await computeMainImagePieceRgb(args.main, args.cols, args.rows);
  const { rgb: targetRgb, lab: targetLab } = computeRegionColors(regions, args.cols, pieceRgb);
  const regionNeighbors = computeRegionNeighbors(bands, args.cols, args.rows);

  console.log(`[build-mosaic] selecting tiles for ${regions.length} regions (no repeats)...`);
  const t0 = Date.now();
  const { assignment, avgDeltaE, flatUsed } = selectTiles(
    regions,
    tileLab,
    tileBlackFrac,
    tileFiles.length,
    targetLab,
    regionNeighbors,
  );
  console.log(
    `[build-mosaic] selection done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ` +
      `avg dE76 ${avgDeltaE.toFixed(2)}, ${flatUsed} flat/space tiles used, ` +
      `${tileFiles.length - regions.length} tiles left unused`,
  );

  if (args.dryRun) {
    console.log(`[build-mosaic] dry-run: stopping before render`);
    return;
  }

  sharp.concurrency(1);
  const mainRgb = args.globalTint > 0 ? await loadMainImageRgb(args.main) : undefined;

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
    tileFiles,
    tilesDir: args.tiles,
    blend: args.blend,
    border: args.border,
    borderColor: args.borderColor,
    globalTint: args.globalTint,
    mainRgb,
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
