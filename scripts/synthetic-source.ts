/**
 * Procedural synthetic source for pipeline testing.
 *
 * Stands in for a real gigapixel raster without ever materializing one: any
 * world-space window is rendered on demand as an SVG, so the slicer can pull
 * per-piece and Deep Zoom tiles from an N x N "image" that only exists as a
 * function. The pattern is position-dependent (a global gradient, a grid on
 * piece boundaries, per-cell coordinate labels, a center crosshair). Detail is
 * gated by the output scale, so a fully zoomed-out tile stays bounded while a
 * 1:1 piece tile still shows fine structure to judge AVIF sharpness.
 *
 * Preview:
 *   tsx scripts/synthetic-source.ts --out generated/synthetic-preview
 */

import { mkdir } from "node:fs/promises";
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
  return sharp(Buffer.from(buildWindowSvg(spec, win, outW, outH)));
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

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("synthetic-source.ts");
if (isMain) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--out");
  const outDir = i >= 0 ? argv[i + 1] : "generated/synthetic-preview";
  preview(outDir).catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
