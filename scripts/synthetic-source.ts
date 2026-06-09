/**
 * Procedural synthetic source for pipeline testing.
 *
 * Stands in for a real gigapixel raster: any world-space window is rendered on
 * demand as an SVG, and `materialize` writes those windows into a real tiled
 * pyramidal TIFF the slicer treats exactly like a final photo. The pattern is
 * position-dependent (a global gradient, a grid on piece boundaries, per-cell
 * coordinate labels, a center crosshair). Detail is gated by the output scale,
 * so a fully zoomed-out tile stays bounded while a 1:1 piece tile still shows
 * fine structure to judge AVIF sharpness.
 *
 * Preview a few windows:
 *   tsx scripts/synthetic-source.ts --out generated/synthetic-preview
 *
 * Materialize a real source file the slicer can read:
 *   tsx scripts/synthetic-source.ts materialize --out samples/source/synthetic.tif \
 *     --cols 200 --rows 200 --piece-size 80
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export type SyntheticSpec = {
  cols: number;
  rows: number;
  pieceSize: number;
};

export type Window = { left: number; top: number; width: number; height: number };

export function syntheticWorldSize(spec: SyntheticSpec): { width: number; height: number } {
  return { width: spec.cols * spec.pieceSize, height: spec.rows * spec.pieceSize };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function buildWindowSvg(spec: SyntheticSpec, win: Window, outW: number, outH: number): string {
  const scale = win.width / outW; // world px per output px
  const cellOut = spec.pieceSize / scale; // a cell's size in output px
  const world = syntheticWorldSize(spec);

  const c0 = clamp(Math.floor(win.left / spec.pieceSize), 0, spec.cols - 1);
  const c1 = clamp(Math.floor((win.left + win.width - 1) / spec.pieceSize), 0, spec.cols - 1);
  const r0 = clamp(Math.floor(win.top / spec.pieceSize), 0, spec.rows - 1);
  const r1 = clamp(Math.floor((win.top + win.height - 1) / spec.pieceSize), 0, spec.rows - 1);

  const drawMinor = cellOut >= 7;
  const drawMajor = cellOut * 10 >= 5;
  const drawLabels = cellOut >= 44;
  const strokeWorld = Math.max(scale, spec.pieceSize * 0.012);

  const parts: string[] = [];
  // userSpaceOnUse keeps the gradient continuous across windows.
  parts.push(
    `<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${world.width}" y2="${world.height}">` +
      `<stop offset="0" stop-color="#15233f"/>` +
      `<stop offset="0.5" stop-color="#2f6f6a"/>` +
      `<stop offset="1" stop-color="#d9772b"/>` +
      `</linearGradient></defs>`,
  );
  parts.push(
    `<rect x="${win.left}" y="${win.top}" width="${win.width}" height="${win.height}" fill="url(#g)"/>`,
  );

  const lines: string[] = [];
  for (let c = c0; c <= c1 + 1; c++) {
    const major = c % 10 === 0;
    if (major ? !drawMajor : !drawMinor) continue;
    const x = c * spec.pieceSize;
    lines.push(
      `<line x1="${x}" y1="${win.top}" x2="${x}" y2="${win.top + win.height}" ` +
        `stroke="${major ? "#ffffff" : "#000000"}" stroke-opacity="${major ? 0.5 : 0.22}" ` +
        `stroke-width="${strokeWorld * (major ? 2.4 : 1)}"/>`,
    );
  }
  for (let r = r0; r <= r1 + 1; r++) {
    const major = r % 10 === 0;
    if (major ? !drawMajor : !drawMinor) continue;
    const y = r * spec.pieceSize;
    lines.push(
      `<line x1="${win.left}" y1="${y}" x2="${win.left + win.width}" y2="${y}" ` +
        `stroke="${major ? "#ffffff" : "#000000"}" stroke-opacity="${major ? 0.5 : 0.22}" ` +
        `stroke-width="${strokeWorld * (major ? 2.4 : 1)}"/>`,
    );
  }
  parts.push(lines.join(""));

  if (drawLabels) {
    const labels: string[] = [];
    const fs = spec.pieceSize * 0.15;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = c * spec.pieceSize + spec.pieceSize * 0.08;
        const y = r * spec.pieceSize + fs * 1.15;
        labels.push(
          `<text x="${x}" y="${y}" font-family="monospace" font-size="${fs}" ` +
            `fill="#ffffff" fill-opacity="0.95">${c},${r}</text>`,
        );
        const cx = c * spec.pieceSize + spec.pieceSize / 2;
        const cy = r * spec.pieceSize + spec.pieceSize / 2;
        const h = spec.pieceSize * 0.18;
        labels.push(
          `<path d="M${cx - h} ${cy} H${cx + h} M${cx} ${cy - h} V${cy + h}" ` +
            `stroke="#ffffff" stroke-width="${spec.pieceSize * 0.01}" stroke-opacity="0.85"/>`,
        );
      }
    }
    parts.push(labels.join(""));
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" ` +
    `viewBox="${win.left} ${win.top} ${win.width} ${win.height}">` +
    parts.join("") +
    `</svg>`
  );
}

/** A sharp pipeline over the rendered window; caller chooses the output codec. */
export function renderSyntheticWindow(
  spec: SyntheticSpec,
  win: Window,
  outW: number,
  outH: number,
): sharp.Sharp {
  return sharp(Buffer.from(buildWindowSvg(spec, win, outW, outH)), { limitInputPixels: false });
}

// Deep Zoom / random-access tile edge for the materialized TIFF. 512 keeps a
// piece window (tileSize ~ pieceSize + 2 * margin) inside a handful of tiles.
const TIFF_TILE = 512;

// The SVG rasterizer caps a single render at 32767 px on either axis, so the
// source is built from a grid of chunks rather than full-width bands. The chunk
// world size also bounds peak render RAM (chunk^2 * 4 bytes RGBA), and a chunk
// must stay under the rasterizer cap.
const MAX_CHUNK = 16384;
const DEFAULT_CHUNK = 8192;

// Write the synthetic pattern as a real tiled pyramidal TIFF at the full world
// size. Each chunk is rendered at 1:1 and saved to a temp file (peak RAM is one
// chunk), then libvips composites the chunk files onto a full-size canvas and
// writes the tiled pyramid, spilling the oversize intermediate to a disc-backed
// temporary so RAM stays bounded by the tile cache, not the gigapixel raster.
export async function materializeSyntheticSource(
  spec: SyntheticSpec,
  outPath: string,
  opts: { chunk?: number; quality?: number } = {},
): Promise<{ width: number; height: number }> {
  const { width, height } = syntheticWorldSize(spec);
  const chunk = Math.min(opts.chunk ?? DEFAULT_CHUNK, MAX_CHUNK);
  const quality = opts.quality ?? 90;

  await mkdir(path.dirname(outPath), { recursive: true });
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "mpp-synthetic-"));
  try {
    const composites: sharp.OverlayOptions[] = [];
    const cols = Math.ceil(width / chunk);
    const rows = Math.ceil(height / chunk);
    let done = 0;
    for (let top = 0; top < height; top += chunk) {
      for (let left = 0; left < width; left += chunk) {
        const w = Math.min(chunk, width - left);
        const h = Math.min(chunk, height - top);
        const file = path.join(tmpDir, `chunk-${left}-${top}.tif`);
        await renderSyntheticWindow(spec, { left, top, width: w, height: h }, w, h)
          .removeAlpha()
          .tiff({ compression: "deflate" })
          .toFile(file);
        composites.push({ input: file, left, top });
      }
      done++;
      console.log(`rendered chunk row ${done}/${rows} (${cols} chunks each)`);
    }

    await sharp({
      create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
      limitInputPixels: false,
    })
      .composite(composites)
      .tiff({
        tile: true,
        tileWidth: TIFF_TILE,
        tileHeight: TIFF_TILE,
        pyramid: true,
        compression: "jpeg",
        quality,
      })
      .toFile(outPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
  return { width, height };
}

async function preview(outDir: string): Promise<void> {
  const spec: SyntheticSpec = { cols: 1000, rows: 1000, pieceSize: 80 };
  const world = syntheticWorldSize(spec);
  await mkdir(outDir, { recursive: true });

  const shots: { name: string; win: Window; out: number }[] = [
    // 1:1 piece-scale window around cell (500,500): labels + crosshair + fine grid.
    {
      name: "piece-scale.png",
      win: { left: 40000, top: 40000, width: 320, height: 320 },
      out: 640,
    },
    // mid zoom: 80x80 cells, grid structure without labels.
    { name: "mid-zoom.png", win: { left: 40000, top: 40000, width: 6400, height: 6400 }, out: 640 },
    // whole world: gradient + major grid only (bounded element count).
    {
      name: "world.png",
      win: { left: 0, top: 0, width: world.width, height: world.height },
      out: 640,
    },
  ];

  for (const s of shots) {
    await renderSyntheticWindow(spec, s.win, s.out, s.out).png().toFile(path.join(outDir, s.name));
    console.log(`wrote ${s.name}`);
  }
  console.log(`world is ${world.width}x${world.height}px (${spec.cols}x${spec.rows} cells)`);
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function runMaterialize(argv: string[]): Promise<void> {
  const out = flag(argv, "out");
  if (!out) throw new Error("materialize requires --out <file.tif>");
  const cols = Number(flag(argv, "cols") ?? 200);
  const rows = Number(flag(argv, "rows") ?? 200);
  const pieceSize = Number(flag(argv, "piece-size") ?? 80);
  const chunk = flag(argv, "chunk") ? Number(flag(argv, "chunk")) : undefined;
  const quality = flag(argv, "quality") ? Number(flag(argv, "quality")) : undefined;
  if (!(cols > 0 && rows > 0 && pieceSize > 0)) {
    throw new Error("cols, rows and piece-size must be positive");
  }
  const spec: SyntheticSpec = { cols, rows, pieceSize };
  const { width, height } = syntheticWorldSize(spec);
  console.log(
    `materializing ${cols}x${rows} cells @ ${pieceSize}px -> ${width}x${height}px tiled TIFF at ${out}`,
  );
  const t0 = Date.now();
  await materializeSyntheticSource(spec, out, { chunk, quality });
  console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("synthetic-source.ts");
if (isMain) {
  const argv = process.argv.slice(2);
  const task =
    argv[0] === "materialize"
      ? runMaterialize(argv.slice(1))
      : preview(flag(argv, "out") ?? "generated/synthetic-preview");
  task.catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
