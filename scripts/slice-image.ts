/**
 * Slice a source image into N rectangular piece tiles and emit a manifest.
 *
 * Each output tile is `pieceSize + 2 * margin` pixels square, centered on the
 * piece's grid cell. Tiles that extend past the source bounds are padded with
 * transparent pixels so every tile has identical dimensions.
 *
 * The bezier silhouette mask is intentionally NOT applied here. The frontend
 * applies the mask at render time using the piece geometry from `@mpp/shared`.
 *
 * `pieceSize` defaults to the largest integer that lets `cols * pieceSize` and
 * `rows * pieceSize` fit inside the source image. The puzzle area is
 * center-cropped from the source; any leftover band on the longer axis is
 * discarded.
 *
 * Usage:
 *   npm run slice -- --input samples/source/puzzle.png \
 *                    --seed test123 --rows 7 --cols 7 \
 *                    --name "Tidepools #003" --output generated/test
 *
 * `--name` is the human-readable puzzle name; it defaults to the output
 * directory basename when omitted.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { ImageManifest } from "@mpp/shared";

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
  };
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const sourceMeta = await sharp(args.input).metadata();
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

  const idWidth = Math.max(4, String(args.rows * args.cols - 1).length);
  const sourceBuffer = await sharp(args.input)
    .extract({
      left: cropLeft,
      top: cropTop,
      width: puzzleWidth,
      height: puzzleHeight,
    })
    .toBuffer();
  const croppedWidth = puzzleWidth;
  const croppedHeight = puzzleHeight;
  const pieces: ImageManifest["pieces"] = [];

  for (let row = 0; row < args.rows; row++) {
    for (let col = 0; col < args.cols; col++) {
      const id = row * args.cols + col;
      const tileLeft = col * pieceSize - margin;
      const tileTop = row * pieceSize - margin;

      const left = Math.max(0, tileLeft);
      const top = Math.max(0, tileTop);
      const right = Math.min(croppedWidth, tileLeft + tileSize);
      const bottom = Math.min(croppedHeight, tileTop + tileSize);
      const extractWidth = right - left;
      const extractHeight = bottom - top;
      const padLeft = left - tileLeft;
      const padTop = top - tileTop;
      const padRight = tileSize - extractWidth - padLeft;
      const padBottom = tileSize - extractHeight - padTop;

      const fileName = `${pad(id, idWidth)}.avif`;
      const outPath = path.join(piecesDir, fileName);

      await sharp(sourceBuffer)
        .extract({
          left,
          top,
          width: extractWidth,
          height: extractHeight,
        })
        .ensureAlpha()
        .extend({
          top: padTop,
          bottom: padBottom,
          left: padLeft,
          right: padRight,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .avif({ quality: args.quality, effort: 4 })
        .toFile(outPath);

      pieces.push({ id, file: `pieces/${fileName}` });
    }
  }

  const manifest: ImageManifest = {
    puzzleId,
    name: args.name ?? puzzleId,
    seed: args.seed,
    rows: args.rows,
    cols: args.cols,
    pieceSize,
    margin,
    tileSize,
    source: {
      file: path.basename(args.input),
      width: sourceMeta.width,
      height: sourceMeta.height,
    },
    pieces,
  };
  await writeFile(path.join(args.output, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`sliced ${pieces.length} pieces (${tileSize}x${tileSize} each) to ${args.output}`);
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1]?.endsWith("slice-image.ts");
if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
