/**
 * Slice a source image into N pre-masked piece tiles and emit a manifest.
 *
 * The source is read as a real file through libvips (random access): each piece
 * window is extracted directly from the (tiled) source rather than from a global
 * in-RAM buffer, so a gigapixel source streams instead of loading whole. Every
 * output tile is `pieceSize + 2 * margin` pixels square, centered on the piece's
 * grid cell; tiles that extend past the puzzle area are padded transparent so
 * every tile has identical dimensions.
 *
 * The bezier silhouette is baked into the tile's alpha here: the piece path from
 * `@mpp/shared` is rasterized to a mask and composited `dest-in` over the window,
 * so the AVIF is already cut to the piece shape and the frontend renders it as-is
 * (manifest `premasked: true`).
 *
 * Tiles are bucketed by hundreds: `pieces/<bucket>/<id>.avif` where
 * `bucket = floor(id / 100)` zero-padded to 4 digits.
 *
 * `pieceSize` defaults to the largest integer that lets `cols * pieceSize` and
 * `rows * pieceSize` fit inside the source image. The puzzle area is
 * center-cropped from the source; any leftover band on the longer axis is
 * discarded.
 *
 * The center-cropped puzzle area is also written as a Deep Zoom pyramid next
 * to the manifest (`source.dzi` + `source_files/`), streamed from the source
 * file. It maps 1:1 onto the puzzle world rect (origin at the top-left piece)
 * and is what the frontend reference panel displays via OpenSeadragon.
 *
 * Usage:
 *   npm run slice -- --input samples/source/puzzle.png \
 *                    --seed test123 --rows 7 --cols 7 \
 *                    --name "Tidepools #003" --output generated/test
 *
 * `--name` is the human-readable puzzle name; it defaults to the output
 * directory basename when omitted. `--concurrency` bounds how many piece tiles
 * are encoded in parallel.
 */

import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  generatePieceGeometry,
  piecePath,
  seedFromString,
  type ImageManifest,
  type PathCommand,
} from "@mpp/shared";

type Args = {
  input: string;
  output: string;
  seed: string;
  name?: string;
  rows: number;
  cols: number;
  pieceSize?: number;
  margin?: number;
  quality: number;
  concurrency: number;
};

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) continue;
    const key = flag.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    args[key] = value;
    i++;
  }
  const required = ["input", "output", "seed", "rows", "cols"];
  for (const k of required) {
    if (!(k in args)) throw new Error(`missing required flag --${k}`);
  }
  return {
    input: args["input"],
    output: args["output"],
    seed: args["seed"],
    name: args["name"],
    rows: parseInt(args["rows"], 10),
    cols: parseInt(args["cols"], 10),
    pieceSize: args["piece-size"] ? parseInt(args["piece-size"], 10) : undefined,
    margin: args["margin"] ? parseInt(args["margin"], 10) : undefined,
    quality: args["quality"] ? parseInt(args["quality"], 10) : 60,
    concurrency: args["concurrency"]
      ? parseInt(args["concurrency"], 10)
      : Math.max(2, os.cpus().length),
  };
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

// SVG path string for the piece silhouette in tile-local space: the piece path
// is in piece-local coords (origin at the piece top-left), so each command is
// shifted by +margin to place the body at [margin, margin + pieceSize] inside
// the tile, leaving the margin ring for tabs.
function pieceMaskSvg(cmds: PathCommand[], margin: number, tileSize: number): Buffer {
  const parts: string[] = [];
  for (const c of cmds) {
    if (c.t === "M") parts.push(`M${c.x + margin} ${c.y + margin}`);
    else if (c.t === "L") parts.push(`L${c.x + margin} ${c.y + margin}`);
    else if (c.t === "C")
      parts.push(
        `C${c.cp1x + margin} ${c.cp1y + margin} ${c.cp2x + margin} ${c.cp2y + margin} ${c.x + margin} ${c.y + margin}`,
      );
    else if (c.t === "Z") parts.push("Z");
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tileSize}" height="${tileSize}">` +
      `<path d="${parts.join(" ")}" fill="#fff"/></svg>`,
  );
}

// Runs `fn(id)` for ids 0..total-1 with at most `limit` in flight, so a 1M-piece
// run encodes across cores without materializing an id array or firing every
// AVIF encode at once.
async function forEachPiece(
  total: number,
  limit: number,
  fn: (id: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const id = next++;
      if (id >= total) return;
      await fn(id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, total) }, worker));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const sourceMeta = await sharp(args.input, { limitInputPixels: false }).metadata();
  if (!sourceMeta.width || !sourceMeta.height) {
    throw new Error("could not read source image dimensions");
  }

  const pieceSize =
    args.pieceSize ??
    Math.floor(Math.min(sourceMeta.width / args.cols, sourceMeta.height / args.rows));
  if (pieceSize < 1) {
    throw new Error("derived pieceSize is below 1, image too small for grid");
  }

  const margin = args.margin ?? Math.round(0.35 * pieceSize);
  const tileSize = pieceSize + 2 * margin;

  const puzzleWidth = args.cols * pieceSize;
  const puzzleHeight = args.rows * pieceSize;
  if (puzzleWidth > sourceMeta.width || puzzleHeight > sourceMeta.height) {
    throw new Error(
      `puzzle area ${puzzleWidth}x${puzzleHeight} does not fit in source ${sourceMeta.width}x${sourceMeta.height}`,
    );
  }
  const cropLeft = Math.floor((sourceMeta.width - puzzleWidth) / 2);
  const cropTop = Math.floor((sourceMeta.height - puzzleHeight) / 2);

  const puzzleId = path.basename(args.output);
  const piecesDir = path.join(args.output, "pieces");
  await mkdir(piecesDir, { recursive: true });

  const total = args.rows * args.cols;
  const idWidth = Math.max(4, String(total - 1).length);
  const base = seedFromString(args.seed);

  // Pre-create the hundred-buckets once (concurrent workers would otherwise race
  // mkdir for the same bucket).
  const bucketCount = Math.floor((total - 1) / 100) + 1;
  for (let b = 0; b < bucketCount; b++) {
    await mkdir(path.join(piecesDir, pad(b, 4)), { recursive: true });
  }

  const pieces: ImageManifest["pieces"] = new Array(total);

  // One libvips thread per op; parallelism comes from the worker pool so the
  // many small per-piece ops do not oversubscribe the cores.
  sharp.concurrency(1);
  await forEachPiece(total, args.concurrency, async (id) => {
    const row = Math.floor(id / args.cols);
    const col = id % args.cols;

    // Tile window in source coordinates, clamped to the puzzle area; the margin
    // overhang at the puzzle border is padded transparent (and masked away,
    // since border edges are flat).
    const tileLeft = cropLeft + col * pieceSize - margin;
    const tileTop = cropTop + row * pieceSize - margin;
    const left = Math.max(cropLeft, tileLeft);
    const top = Math.max(cropTop, tileTop);
    const right = Math.min(cropLeft + puzzleWidth, tileLeft + tileSize);
    const bottom = Math.min(cropTop + puzzleHeight, tileTop + tileSize);
    const extractWidth = right - left;
    const extractHeight = bottom - top;
    const padLeft = left - tileLeft;
    const padTop = top - tileTop;
    const padRight = tileSize - extractWidth - padLeft;
    const padBottom = tileSize - extractHeight - padTop;

    const geom = generatePieceGeometry(base, args.rows, args.cols, pieceSize, id);
    const mask = pieceMaskSvg(piecePath(geom, pieceSize), margin, tileSize);

    const idStr = pad(id, idWidth);
    const bucket = pad(Math.floor(id / 100), 4);
    const fileName = `${idStr}.avif`;
    const outPath = path.join(piecesDir, bucket, fileName);

    await sharp(args.input, { limitInputPixels: false })
      .extract({ left, top, width: extractWidth, height: extractHeight })
      .ensureAlpha()
      .extend({
        top: padTop,
        bottom: padBottom,
        left: padLeft,
        right: padRight,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .composite([{ input: mask, blend: "dest-in" }])
      .avif({ quality: args.quality, effort: 4 })
      .toFile(outPath);

    pieces[id] = { id, file: `pieces/${bucket}/${fileName}` };
  });

  // Deep Zoom pyramid of the cropped puzzle area, streamed from the source file
  // (no global buffer): the same random-access read path as the pieces.
  sharp.concurrency(0);
  const dziName = "source.dzi";
  await sharp(args.input, { limitInputPixels: false })
    .extract({ left: cropLeft, top: cropTop, width: puzzleWidth, height: puzzleHeight })
    .webp({ quality: args.quality, effort: 4 })
    .tile({ layout: "dz", size: 254, overlap: 1, basename: "source" })
    .toFile(path.join(args.output, "source"));

  const manifest: ImageManifest = {
    puzzleId,
    name: args.name ?? puzzleId,
    seed: args.seed,
    rows: args.rows,
    cols: args.cols,
    pieceSize,
    margin,
    tileSize,
    premasked: true,
    source: {
      dzi: dziName,
      width: puzzleWidth,
      height: puzzleHeight,
    },
    pieces,
  };
  await writeFile(path.join(args.output, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(
    `sliced ${pieces.length} alpha-cut pieces (${tileSize}x${tileSize} each) and a ${puzzleWidth}x${puzzleHeight} reference pyramid to ${args.output}`,
  );
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1]?.endsWith("slice-image.ts");
if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
