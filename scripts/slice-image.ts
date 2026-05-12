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
 * Usage:
 *   npm run slice -- --input samples/source/puzzle.png \
 *                    --seed test123 --rows 7 --cols 7 \
 *                    --piece-size 200 --output generated/test
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
  rows: number;
  cols: number;
  pieceSize: number;
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
  const required = ["input", "output", "seed", "rows", "cols", "piece-size"];
  for (const k of required) {
    if (!(k in args)) throw new Error(`missing required flag --${k}`);
  }
  return {
    input: args["input"],
    output: args["output"],
    seed: args["seed"],
    rows: parseInt(args["rows"], 10),
    cols: parseInt(args["cols"], 10),
    pieceSize: parseInt(args["piece-size"], 10),
    margin: args["margin"] ? parseInt(args["margin"], 10) : undefined,
    quality: args["quality"] ? parseInt(args["quality"], 10) : 60,
  };
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const margin = args.margin ?? Math.round(0.35 * args.pieceSize);
  const tileSize = args.pieceSize + 2 * margin;

  const sourceMeta = await sharp(args.input).metadata();
  if (!sourceMeta.width || !sourceMeta.height) {
    throw new Error("could not read source image dimensions");
  }
  const expectedWidth = args.cols * args.pieceSize;
  const expectedHeight = args.rows * args.pieceSize;
  if (
    sourceMeta.width !== expectedWidth ||
    sourceMeta.height !== expectedHeight
  ) {
    throw new Error(
      `source image is ${sourceMeta.width}x${sourceMeta.height}, expected ${expectedWidth}x${expectedHeight} (${args.cols} cols * ${args.rows} rows * ${args.pieceSize}px)`,
    );
  }

  const puzzleId = path.basename(args.output);
  const piecesDir = path.join(args.output, "pieces");
  await mkdir(piecesDir, { recursive: true });

  const idWidth = Math.max(4, String(args.rows * args.cols - 1).length);
  const sourceBuffer = await sharp(args.input).toBuffer();
  const pieces: ImageManifest["pieces"] = [];

  for (let row = 0; row < args.rows; row++) {
    for (let col = 0; col < args.cols; col++) {
      const id = row * args.cols + col;
      const tileLeft = col * args.pieceSize - margin;
      const tileTop = row * args.pieceSize - margin;

      const left = Math.max(0, tileLeft);
      const top = Math.max(0, tileTop);
      const right = Math.min(sourceMeta.width, tileLeft + tileSize);
      const bottom = Math.min(sourceMeta.height, tileTop + tileSize);
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
    seed: args.seed,
    rows: args.rows,
    cols: args.cols,
    pieceSize: args.pieceSize,
    margin,
    tileSize,
    source: {
      file: path.basename(args.input),
      width: sourceMeta.width,
      height: sourceMeta.height,
    },
    pieces,
  };
  await writeFile(
    path.join(args.output, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  console.log(
    `sliced ${pieces.length} pieces (${tileSize}x${tileSize} each) to ${args.output}`,
  );
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("slice-image.ts");
if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
