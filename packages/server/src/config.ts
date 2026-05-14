import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageManifest } from "@mpp/shared";

export type ServerConfig = {
  port: number;
  redisUrl: string;
  mongoUrl: string;
  mongoDb: string;
  manifestPath: string;
  manifest: ImageManifest;
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
  };
}
