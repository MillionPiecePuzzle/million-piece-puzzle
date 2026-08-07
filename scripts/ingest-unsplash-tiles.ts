/**
 * Ingest a folder of already-downloaded Unsplash photos into the same
 * samples/tiles/manifest.json build-mosaic.ts reads, alongside any
 * Wikimedia-sourced tiles fetch-tile-images.ts already fetched.
 *
 * Unlike fetch-tile-images.ts, this never talks to a network or an API:
 * downloading itself is a manual step (Unsplash+'s "Download All", or a
 * per-photo download), done by a person in a real browser, matching
 * Unsplash's own guidelines, which expect a human choosing each download
 * rather than automation. This script only organizes files already on
 * disk into the manifest.
 *
 * Expects Unsplash's own download filename convention:
 * <photographer-slug>-<11-char-photo-id>-unsplash.<ext>. A file that
 * doesn't match is skipped with a tally, not an error: a source folder can
 * reasonably hold other, unrelated files alongside the downloads.
 *
 * Usage:
 *   tsx scripts/ingest-unsplash-tiles.ts --source "C:\path\to\downloads"
 *   tsx scripts/ingest-unsplash-tiles.ts --source ... --out samples/tiles
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const FILENAME_PATTERN = /^(.+)-([A-Za-z0-9_-]{11})-unsplash\.(jpe?g|png|webp)$/i;
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

type Args = { source: string; out: string };

type TileEntry = {
  pageId: string;
  title: string;
  file: string;
  width: number;
  height: number;
  downloadedWidth: number;
  downloadedHeight: number;
  mime: string;
  licenseShortName: string;
  descriptionUrl: string;
  sourceUrl: string;
  author: string;
  categorySeed: string;
  fetchedAt: string;
};

type Manifest = {
  generatedAt: string;
  source: string;
  licenseAllowlist: string[];
  categories: Record<string, unknown>;
  tiles: TileEntry[];
};

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseArgs(argv: string[]): Args {
  const source = flag(argv, "source");
  if (!source) throw new Error("missing required flag --source <folder>");
  return { source, out: flag(argv, "out") ?? "samples/tiles" };
}

async function loadManifest(out: string): Promise<Manifest> {
  const file = path.join(out, "manifest.json");
  if (existsSync(file)) {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as Manifest;
    parsed.categories ??= {};
    return parsed;
  }
  return {
    generatedAt: new Date().toISOString(),
    source: "Wikimedia Commons",
    licenseAllowlist: [],
    categories: {},
    tiles: [],
  };
}

async function saveManifest(out: string, manifest: Manifest): Promise<void> {
  await writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const manifest = await loadManifest(args.out);
  if (!manifest.source.includes("Unsplash")) manifest.source += " + Unsplash";

  const knownIds = new Set(manifest.tiles.map((t) => t.pageId));

  const entries = await readdir(args.source, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  let accepted = 0;
  let skippedDuplicate = 0;
  let skippedNoMatch = 0;
  let skippedUnreadable = 0;

  for (const name of files) {
    const match = FILENAME_PATTERN.exec(name);
    if (!match) {
      skippedNoMatch++;
      continue;
    }
    const [, authorSlug, photoId, extRaw] = match as unknown as [string, string, string, string];
    const ext = extRaw.toLowerCase() === "jpeg" ? "jpg" : extRaw.toLowerCase();
    if (knownIds.has(photoId)) {
      skippedDuplicate++;
      continue;
    }

    const srcPath = path.join(args.source, name);
    let width: number | undefined;
    let height: number | undefined;
    try {
      const metadata = await sharp(srcPath, { limitInputPixels: false }).metadata();
      width = metadata.width;
      height = metadata.height;
    } catch {
      // fall through, width stays undefined
    }
    if (!width || !height) {
      skippedUnreadable++;
      continue;
    }

    const destFile = `${photoId}.${ext}`;
    await copyFile(srcPath, path.join(args.out, destFile));

    const author = authorSlug.replace(/-/g, " ");
    const entry: TileEntry = {
      pageId: photoId,
      title: author,
      file: destFile,
      width,
      height,
      downloadedWidth: width,
      downloadedHeight: height,
      mime: MIME_BY_EXT[ext] ?? `image/${ext}`,
      licenseShortName: "Unsplash",
      descriptionUrl: `https://unsplash.com/photos/${photoId}`,
      sourceUrl: `https://unsplash.com/photos/${photoId}`,
      author,
      categorySeed: "unsplash",
      fetchedAt: new Date().toISOString(),
    };
    manifest.tiles.push(entry);
    knownIds.add(photoId);
    accepted++;
  }

  await saveManifest(args.out, manifest);
  console.log(
    `[ingest-unsplash-tiles] accepted ${accepted}, ${skippedDuplicate} already known, ` +
      `${skippedNoMatch} not matching the Unsplash filename pattern, ${skippedUnreadable} unreadable ` +
      `(${files.length} files scanned in ${args.source})`,
  );
  console.log(`[ingest-unsplash-tiles] manifest now has ${manifest.tiles.length} tiles total`);
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("ingest-unsplash-tiles.ts");
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
