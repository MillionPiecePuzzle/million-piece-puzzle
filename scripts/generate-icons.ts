/**
 * Brand icon generator.
 *
 * Emits the favicon and the standalone PNG icons from a single source: the
 * BrandMark glyph on a cream tile (matching the in-app topbar mark). The mark
 * path and palette mirror packages/frontend/src/components/BrandMark.vue and
 * packages/frontend/src/styles/tokens.css; keep them in sync if either moves.
 *
 * Outputs into packages/frontend/public:
 *   - favicon.svg          rounded cream tile, scalable, primary tab icon
 *   - apple-touch-icon.png 180px full-bleed square (iOS masks the corners)
 *   - discord-icon.png     512px full-bleed square for the Discord server icon
 *
 * Run: npm run icons
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const CREAM = "#f4f1ea";
const INK = "#15140f";

// 22x22 glyph from BrandMark.vue, centered in a 64x64 tile (translate/scale
// keep the ink within ~22% padding so it stays bold at 16px).
const MARK = "M2 2h8v5a2 2 0 0 0 2 2h5v11H2V2zm10 0h8v8h-5a3 3 0 0 1-3-3V2z";
const MARK_GROUP = `<g transform="translate(10 10) scale(2)"><path d="${MARK}" fill="${INK}"/></g>`;

const roundedSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" rx="14" fill="${CREAM}"/>` +
  `${MARK_GROUP}</svg>\n`;

const squareSvg = (px: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" fill="${CREAM}"/>` +
  `${MARK_GROUP}</svg>`;

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../packages/frontend/public",
);

async function writePng(name: string, px: number): Promise<void> {
  const out = path.join(publicDir, name);
  await sharp(Buffer.from(squareSvg(px))).png().toFile(out);
  console.log(`wrote ${name} (${px}x${px})`);
}

async function main(): Promise<void> {
  await writeFile(path.join(publicDir, "favicon.svg"), roundedSvg());
  console.log("wrote favicon.svg");
  await writePng("apple-touch-icon.png", 180);
  await writePng("discord-icon.png", 512);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
