import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageManifest } from "@mpp/shared";
import { parseAllowedOrigins } from "./limits.js";

export type ServerConfig = {
  port: number;
  redisUrl: string;
  mongoUrl: string;
  mongoDb: string;
  manifestPaths: string[];
  manifests: ImageManifest[];
  devEnabled: boolean;
  cycleDelayMs: number;
  allowedOrigins: string[];
  wsMaxPayloadBytes: number;
  wsRateTokensPerSec: number;
  wsRateBurst: number;
  wsBufferedAmountLimitBytes: number;
};

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} is not a number: ${raw}`);
  return n;
}

function str(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`missing required env ${name}`);
  return v;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function resolveManifestList(): string[] {
  const list = process.env.MPP_MANIFESTS;
  if (list) {
    const paths = list
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (paths.length === 0) throw new Error("MPP_MANIFESTS is empty");
    return paths.map((p) => path.resolve(p));
  }
  const single = process.env.MPP_MANIFEST;
  if (single) return [path.resolve(single)];
  throw new Error("missing required env MPP_MANIFESTS (or MPP_MANIFEST for single puzzle)");
}

export async function loadConfig(): Promise<ServerConfig> {
  const manifestPaths = resolveManifestList();
  const manifests: ImageManifest[] = [];
  for (const p of manifestPaths) {
    const raw = await readFile(p, "utf8");
    manifests.push(JSON.parse(raw) as ImageManifest);
  }
  const ids = new Set<string>();
  for (const m of manifests) {
    if (ids.has(m.puzzleId)) throw new Error(`duplicate puzzleId across manifests: ${m.puzzleId}`);
    ids.add(m.puzzleId);
  }
  return {
    port: int("MPP_PORT", 8080),
    redisUrl: str("MPP_REDIS_URL", "redis://127.0.0.1:6379"),
    mongoUrl: str("MPP_MONGO_URL", "mongodb://127.0.0.1:27017"),
    mongoDb: str("MPP_MONGO_DB", "mpp"),
    manifestPaths,
    manifests,
    devEnabled: bool("MPP_DEV_ENABLED", false),
    cycleDelayMs: int("MPP_CYCLE_DELAY_MS", 6000),
    allowedOrigins: parseAllowedOrigins(process.env.MPP_ALLOWED_ORIGINS),
    wsMaxPayloadBytes: int("MPP_WS_MAX_PAYLOAD_BYTES", 64 * 1024),
    wsRateTokensPerSec: int("MPP_WS_RATE_TOKENS_PER_SEC", 200),
    wsRateBurst: int("MPP_WS_RATE_BURST", 400),
    wsBufferedAmountLimitBytes: int("MPP_WS_BUFFERED_AMOUNT_LIMIT_BYTES", 4 * 1024 * 1024),
  };
}
