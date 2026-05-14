import { defineConfig, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { existsSync, statSync, createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

function servePuzzleAssets() {
  const puzzleId = process.env.MPP_PUZZLE_ID ?? "test";
  const root = path.resolve(repoRoot, "generated", puzzleId);
  const mime: Record<string, string> = {
    ".json": "application/json",
    ".avif": "image/avif",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  return {
    name: "mpp:serve-puzzle",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/puzzle", (req, res, next) => {
        if (!req.url) return next();
        const rel = decodeURIComponent(req.url.split("?")[0] ?? "");
        const full = path.join(root, rel);
        if (!full.startsWith(root) || !existsSync(full) || !statSync(full).isFile()) {
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

export default defineConfig({
  plugins: [vue(), servePuzzleAssets()],
  server: {
    port: 5173,
  },
});
