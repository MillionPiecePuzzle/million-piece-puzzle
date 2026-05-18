import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync, statSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const puzzlesRoot = path.resolve(repoRoot, "generated");

function servePuzzleAssets(): Plugin {
  const mime: Record<string, string> = {
    ".json": "application/json",
    ".avif": "image/avif",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return {
    name: "mpp:serve-puzzles",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/puzzles", (req, res, next) => {
        if (!req.url) return next();
        const rel = decodeURIComponent(req.url.split("?")[0] ?? "");
        const full = path.join(puzzlesRoot, rel);
        if (!full.startsWith(puzzlesRoot) || !existsSync(full) || !statSync(full).isFile()) {
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
    name: "mpp:bundle-puzzles",
    apply: "build",
    async closeBundle() {
      if (!existsSync(puzzlesRoot)) {
        throw new Error(`[mpp:bundle-puzzles] missing puzzles dir at ${puzzlesRoot}`);
      }
      const entries = await readdir(puzzlesRoot, { withFileTypes: true });
      const ids = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      if (ids.length === 0) {
        throw new Error(`[mpp:bundle-puzzles] no puzzle directories under ${puzzlesRoot}`);
      }
      const outRoot = path.resolve(repoRoot, "packages/frontend/dist/puzzles");
      await mkdir(outRoot, { recursive: true });
      for (const id of ids) {
        await cp(path.join(puzzlesRoot, id), path.join(outRoot, id), { recursive: true });
      }
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
