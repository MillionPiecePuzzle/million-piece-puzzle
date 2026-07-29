/**
 * Fetch a local library of CC0/public-domain nature and animal photos from
 * Wikimedia Commons, for use as tile source images in `build-mosaic.ts`.
 *
 * Discovery walks a seed list of Commons categories via
 * `generator=categorymembers&gcmtype=file` (direct category membership, not a
 * text search: simpler, always-live, unambiguous), paginated by `gcmcontinue`.
 * `prop=imageinfo` on the same request returns `extmetadata` too, so accepting
 * or rejecting a candidate needs no second call. Only a license in `--license`
 * passes (default CC0/public-domain): this repo shows no photo credit
 * anywhere, so anything requiring attribution is out. CC0/PD is a small
 * minority of Commons nature photography, so reaching `--count` can need many
 * categories and deep pagination; the per-category tally printed as it goes
 * is there to tell you if `--categories` needs widening.
 *
 * Wikimedia's API etiquette asks for serial requests, a real User-Agent, a
 * cooperative `maxlag` param, and backoff on rate limits. This script never
 * fans out requests in parallel.
 *
 * The manifest records, per category, the last `gcmcontinue` reached and
 * whether it's exhausted, so a later run topping up `--count` resumes
 * scanning instead of re-walking every category from page 1.
 *
 * Usage:
 *   tsx scripts/fetch-tile-images.ts --out samples/tiles --count 750
 *   tsx scripts/fetch-tile-images.ts --out samples/tiles --count 25 --dry-run
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT =
  "MillionPiecePuzzle-TileFetcher/1.0 (https://github.com/MillionPiecePuzzle/million-piece-puzzle)";
const MAX_RETRIES = 5;

const DEFAULT_CATEGORIES = [
  "Animals",
  "Mammals",
  "Birds",
  "Insects",
  "Marine life",
  "Reptiles",
  "Nature",
  "Landscapes",
  "Flowers",
  "Trees",
];
const DEFAULT_LICENSES = ["CC0", "CC0 1.0", "Public domain", "Public Domain Mark 1.0"];
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

type Args = {
  categories: string[];
  count: number;
  minDimension: number;
  maxDimension: number;
  license: string[];
  delayMs: number;
  out: string;
  dryRun: boolean;
};

type TileEntry = {
  pageId: number;
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

type CategoryState = {
  gcmcontinue?: string;
  exhausted: boolean;
};

type Manifest = {
  generatedAt: string;
  source: string;
  licenseAllowlist: string[];
  categories: Record<string, CategoryState>;
  tiles: TileEntry[];
};

type ExtMetadataField = { value: string };

type ImageInfo = {
  mime: string;
  url: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  width: number;
  height: number;
  descriptionurl: string;
  extmetadata?: Record<string, ExtMetadataField>;
};

type QueryPage = {
  pageid: number;
  title: string;
  imageinfo?: ImageInfo[];
};

type QueryResponse = {
  continue?: { gcmcontinue?: string };
  query?: { pages?: Record<string, QueryPage> };
  error?: { code: string; info?: string };
};

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function parseArgs(argv: string[]): Args {
  const categories = flag(argv, "categories")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const license = flag(argv, "license")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    categories: categories?.length ? categories : DEFAULT_CATEGORIES,
    count: Number(flag(argv, "count") ?? 750),
    minDimension: Number(flag(argv, "min-dimension") ?? 768),
    maxDimension: Number(flag(argv, "max-dimension") ?? 1600),
    license: license?.length ? license : DEFAULT_LICENSES,
    delayMs: Number(flag(argv, "delay-ms") ?? 300),
    out: flag(argv, "out") ?? "samples/tiles",
    dryRun: argv.includes("--dry-run"),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadManifest(out: string): Promise<Manifest> {
  const file = path.join(out, "manifest.json");
  if (existsSync(file)) {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as Manifest;
    parsed.categories ??= {};
    // A file deleted by hand should be re-fetched, not silently treated as present.
    parsed.tiles = parsed.tiles.filter((t) => existsSync(path.join(out, t.file)));
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

async function apiRequest(params: Record<string, string>): Promise<QueryResponse> {
  const url = new URL(API);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("maxlag", "5");

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 429) {
        lastErr = new Error("HTTP 429");
        continue;
      }
      const body = (await res.json()) as QueryResponse;
      const code = body.error?.code;
      if (code === "ratelimited" || code === "maxlag") {
        lastErr = new Error(`Wikimedia API: ${code}`);
        continue;
      }
      if (body.error) throw new Error(`Wikimedia API error: ${code} ${body.error.info ?? ""}`);
      return body;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function downloadFile(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 429) {
        lastErr = new Error("HTTP 429");
        continue;
      }
      if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const manifest = await loadManifest(args.out);
  manifest.licenseAllowlist = args.license;

  const acceptedPageIds = new Set(manifest.tiles.map((t) => t.pageId));
  let totalAccepted = manifest.tiles.length;
  console.log(`[fetch-tiles] ${totalAccepted}/${args.count} already accepted`);

  for (const category of args.categories) {
    if (totalAccepted >= args.count) break;
    const state = manifest.categories[category] ?? { exhausted: false };
    manifest.categories[category] = state;
    if (state.exhausted) {
      console.log(`[fetch-tiles] ${category}: already exhausted, skipping`);
      continue;
    }

    let scanned = 0;
    let accepted = 0;

    for (;;) {
      if (totalAccepted >= args.count) break;

      const params: Record<string, string> = {
        action: "query",
        format: "json",
        generator: "categorymembers",
        gcmtitle: `Category:${category}`,
        gcmtype: "file",
        gcmlimit: "50",
        prop: "imageinfo",
        iiprop: "url|size|mime|extmetadata",
        iiurlwidth: String(args.maxDimension),
      };
      if (state.gcmcontinue) params.gcmcontinue = state.gcmcontinue;

      const body = await apiRequest(params);
      const pages = Object.values(body.query?.pages ?? {});

      for (const page of pages) {
        if (totalAccepted >= args.count) break;
        scanned++;
        const info = page.imageinfo?.[0];
        if (!info) continue;
        if (acceptedPageIds.has(page.pageid)) continue;

        const ext = MIME_EXT[info.mime];
        if (!ext) continue;
        if (info.width < args.minDimension || info.height < args.minDimension) continue;
        const license = info.extmetadata?.["LicenseShortName"]?.value;
        if (!license || !args.license.includes(license)) continue;

        accepted++;
        if (args.dryRun) {
          totalAccepted++;
          continue;
        }

        const thumbUrl = info.thumburl ?? info.url;
        await sleep(args.delayMs);
        const bytes = await downloadFile(thumbUrl);
        const fileName = `${page.pageid}.${ext}`;
        await writeFile(path.join(args.out, fileName), bytes);

        const entry: TileEntry = {
          pageId: page.pageid,
          title: page.title,
          file: fileName,
          width: info.width,
          height: info.height,
          downloadedWidth: info.thumbwidth ?? info.width,
          downloadedHeight: info.thumbheight ?? info.height,
          mime: info.mime,
          licenseShortName: license,
          descriptionUrl: info.descriptionurl,
          sourceUrl: info.url,
          author: info.extmetadata?.["Artist"]?.value ?? "",
          categorySeed: category,
          fetchedAt: new Date().toISOString(),
        };
        manifest.tiles.push(entry);
        acceptedPageIds.add(page.pageid);
        totalAccepted++;
        await saveManifest(args.out, manifest);
      }

      console.log(`[fetch-tiles] ${category}: accepted ${accepted} / scanned ${scanned}`);

      const cont = body.continue?.gcmcontinue;
      if (!args.dryRun) {
        if (!cont) state.exhausted = true;
        else state.gcmcontinue = cont;
        await saveManifest(args.out, manifest);
      }
      if (!cont) break;

      await sleep(args.delayMs);
    }
  }

  console.log(
    `[fetch-tiles] done: ${totalAccepted}/${args.count} tiles` +
      (args.dryRun ? " (dry-run, nothing downloaded)" : ""),
  );
}

const isMain =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1]?.endsWith("fetch-tile-images.ts");
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
