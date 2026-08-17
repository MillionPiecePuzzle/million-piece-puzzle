/**
 * Brand icon generator.
 *
 * Composites public/brand-mark.png (the puzzle-piece glyph, transparent
 * background) onto a cream tile at each required size. The glyph itself is
 * the single source of truth for the logo; this script and BrandMark.vue
 * both render that same file, so nothing here needs to change if the glyph
 * is ever replaced.
 *
 * Outputs into packages/frontend/public:
 *   - favicon.png          64px rounded cream tile, primary tab icon
 *   - apple-touch-icon.png 180px full-bleed square (iOS masks the corners)
 *   - discord-icon.png     512px full-bleed square for the Discord server icon
 *
 * Run: npm run icons
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const CREAM = "#f4f1ea";
const MARK_FILL_RATIO = 0.68; // glyph occupies ~68% of the tile, centered

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../packages/frontend/public",
);
const markPath = path.join(publicDir, "brand-mark.png");

async function writeTile(name: string, px: number, cornerRadius: number): Promise<void> {
  const base =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">` +
    `<rect width="${px}" height="${px}" rx="${cornerRadius}" fill="${CREAM}"/></svg>`;

  const markSize = Math.round(px * MARK_FILL_RATIO);
  const mark = await sharp(markPath)
    .resize({ width: markSize, height: markSize, fit: "inside" })
    .toBuffer();

  await sharp(Buffer.from(base))
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(path.join(publicDir, name));
  console.log(`wrote ${name} (${px}x${px})`);
}

async function main(): Promise<void> {
  await writeTile("favicon.png", 64, 14);
  await writeTile("apple-touch-icon.png", 180, 0);
  await writeTile("discord-icon.png", 512, 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
