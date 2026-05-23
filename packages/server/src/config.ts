import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageManifest } from "@mpp/shared";
import { parseAllowedOrigins } from "./limits.js";

export type ServerConfig = {
  port: number;
  redisUrl: string;
  mongoUrl: string;
  mongoDb: string;
  manifestPath: string;
  manifest: ImageManifest;
  devEnabled: boolean;
  allowedOrigins: string[];
  wsMaxPayloadBytes: number;
  wsRateTokensPerSec: number;
  wsRateBurst: number;
  wsBufferedAmountLimitBytes: number;
  snapshotIntervalMs: number;
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

export async function loadConfig(): Promise<ServerConfig> {
  const manifestPath = path.resolve(str("MPP_MANIFEST"));
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as ImageManifest;
  return {
    port: int("MPP_PORT", 8080),
    redisUrl: str("MPP_REDIS_URL", "redis://127.0.0.1:6379"),
    mongoUrl: str("MPP_MONGO_URL", "mongodb://127.0.0.1:27017"),
    mongoDb: str("MPP_MONGO_DB", "mpp"),
    manifestPath,
    manifest,
    devEnabled: bool("MPP_DEV_ENABLED", false),
    allowedOrigins: parseAllowedOrigins(process.env.MPP_ALLOWED_ORIGINS),
    wsMaxPayloadBytes: int("MPP_WS_MAX_PAYLOAD_BYTES", 64 * 1024),
    wsRateTokensPerSec: int("MPP_WS_RATE_TOKENS_PER_SEC", 200),
    wsRateBurst: int("MPP_WS_RATE_BURST", 400),
    wsBufferedAmountLimitBytes: int("MPP_WS_BUFFERED_AMOUNT_LIMIT_BYTES", 4 * 1024 * 1024),
    snapshotIntervalMs: int("MPP_SNAPSHOT_INTERVAL_MS", 2000),
  };
}
