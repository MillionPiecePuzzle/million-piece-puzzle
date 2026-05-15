import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { cp, mkdir } from "node:fs/promises";
import { existsSync, statSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const puzzleId = process.env.MPP_PUZZLE_ID ?? "test";
const puzzleSource = path.resolve(repoRoot, "generated", puzzleId);

function servePuzzleAssets(): Plugin {
  const mime: Record<string, string> = {
    ".json": "application/json",
    ".avif": "image/avif",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return {
    name: "mpp:serve-puzzle",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/puzzle", (req, res, next) => {
        if (!req.url) return next();
        const rel = decodeURIComponent(req.url.split("?")[0] ?? "");
        const full = path.join(puzzleSource, rel);
        if (!full.startsWith(puzzleSource) || !existsSync(full) || !statSync(full).isFile()) {
          return next();
        }
        const ext = path.extname(full).toLowerCase();
        res.setHeader("Content-Type", mime[ext] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        createReadStream(full).pipe(res);
      });
    },
  };
}

function bundlePuzzleAssets(): Plugin {
  return {
    name: "mpp:bundle-puzzle",
    apply: "build",
    async closeBundle() {
      if (!existsSync(puzzleSource)) {
        throw new Error(
          `[mpp:bundle-puzzle] missing puzzle assets at ${puzzleSource}. Run \`npm run slice\` or set MPP_PUZZLE_ID.`,
        );
      }
      const outDir = path.resolve(repoRoot, "packages/frontend/dist/puzzle");
      await mkdir(outDir, { recursive: true });
      await cp(puzzleSource, outDir, { recursive: true });
    },
  };
}

function parseAllowedHosts(raw: string | undefined): true | string[] | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "*" || trimmed === "true") return true;
  const list = trimmed
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

const allowedHosts = parseAllowedHosts(process.env.MPP_ALLOWED_HOSTS);

export default defineConfig({
  plugins: [vue(), servePuzzleAssets(), bundlePuzzleAssets()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    ...(allowedHosts !== undefined ? { allowedHosts } : {}),
  },
});
