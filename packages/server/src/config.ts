import type { ImageManifest } from "@mpp/shared";
import { parseAllowedOrigins } from "./limits.js";

export type ServerConfig = {
  port: number;
  redisUrl: string;
  mongoUrl: string;
  mongoDb: string;
  puzzleId: string;
  assetsBaseUrl: string;
  manifestUrl: string;
  manifest: ImageManifest;
  devEnabled: boolean;
  allowedOrigins: string[];
  wsMaxPayloadBytes: number;
  wsRateTokensPerSec: number;
  wsRateBurst: number;
  wsMaxConnectionsPerIp: number;
  wsBufferedAmountLimitBytes: number;
  // Spatial broadcast index (see DECISIONS: spatial broadcast index). The world
  // grid cell is `pieceSize * broadcastCellPieces` wide, sized so a zoomed-in
  // viewport overlaps ~1-4 cells; a viewport (or dragged cluster) overlapping more
  // than broadcastMaxCells cells is treated as global, bounding the subscription
  // set and the per-event cell walk.
  broadcastCellPieces: number;
  broadcastMaxCells: number;
  // Spectator stream cadence (see DECISIONS: spectator keyframe + event log).
  // The keyframe is regenerated at most this often while the event is live; the
  // event window W and interpolation delay D set how the client tails the log;
  // retention bounds how far back a joining client can replay; the idle TTL is
  // the short edge cache used while the keyframe is frozen (pre-event / complete)
  // so the start transition is seen promptly.
  keyframeIntervalMs: number;
  eventWindowMs: number;
  interpDelayMs: number;
  eventRetentionMs: number;
  keyframeIdleTtlMs: number;
  // Unix ms of the event start, carried in welcome and the snapshot so clients
  // sync the entrance cascade. 0 (default) means no scheduled start.
  eventStartsAt: number;
  // Auth.js host base (e.g. https://ws.millionpiecepuzzle.com). The Google
  // callback URL and session action URLs derive from it. The secrets
  // (AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET) stay in process.env and
  // are read by Auth.js directly, never copied into config.
  authUrl: string;
  // Whether session cookies are marked Secure. Derived from authUrl scheme: a
  // Secure cookie is dropped over plain http, so dev on http://localhost must
  // not set it. Also selects the cookie-name prefix (__Secure- when true).
  authSecure: boolean;
  // Domain attribute for the session cookie. Empty means host-only (dev on
  // localhost works across ports). In prod set to ".millionpiecepuzzle.com" so
  // the cookie is readable on the ws.* WS upgrade.
  authCookieDomain: string;
  // SPA origin allowed to make credentialed requests to /auth and /profile, and
  // permitted as an OAuth redirect target.
  appOrigin: string;
  // Per-IP fixed window on all /auth and /profile requests.
  authRateMax: number;
  authRateWindowSec: number;
  // Stricter per-IP fixed window on the OAuth callback, the account-creation
  // chokepoint.
  signupMaxPerIp: number;
  signupWindowSec: number;
  // Per-IP fixed window on the anonymous spectator stream (/keyframe + /events/*),
  // the public read path. Sized well above a legitimate spectator's origin rate
  // (most reads hit the CDN edge; the origin sees only cache misses) so it trips
  // on a flood, not on a NAT of honest viewers.
  spectatorRateMax: number;
  spectatorRateWindowSec: number;
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

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

async function fetchManifest(url: string): Promise<ImageManifest> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`failed to fetch manifest ${url}: ${message}`);
  }
  if (!res.ok) {
    throw new Error(`manifest fetch ${url} returned HTTP ${res.status}`);
  }
  return (await res.json()) as ImageManifest;
}

export async function loadConfig(): Promise<ServerConfig> {
  const puzzleId = str("MPP_PUZZLE_ID");
  const assetsBaseUrl = trimTrailingSlash(str("MPP_ASSETS_BASE_URL"));
  const manifestUrl = `${assetsBaseUrl}/${puzzleId}/manifest.json`;
  const manifest = await fetchManifest(manifestUrl);
  if (manifest.puzzleId !== puzzleId) {
    throw new Error(
      `manifest puzzleId "${manifest.puzzleId}" does not match MPP_PUZZLE_ID "${puzzleId}"`,
    );
  }
  const port = int("MPP_PORT", 8080);
  const allowedOrigins = parseAllowedOrigins(process.env.MPP_ALLOWED_ORIGINS);
  const authUrl = trimTrailingSlash(str("AUTH_URL", `http://localhost:${port}`));
  return {
    port,
    redisUrl: str("MPP_REDIS_URL", "redis://127.0.0.1:6379"),
    mongoUrl: str("MPP_MONGO_URL", "mongodb://127.0.0.1:27017"),
    mongoDb: str("MPP_MONGO_DB", "mpp"),
    puzzleId,
    assetsBaseUrl,
    manifestUrl,
    manifest,
    devEnabled: bool("MPP_DEV_ENABLED", false),
    allowedOrigins,
    wsMaxPayloadBytes: int("MPP_WS_MAX_PAYLOAD_BYTES", 64 * 1024),
    wsRateTokensPerSec: int("MPP_WS_RATE_TOKENS_PER_SEC", 200),
    wsRateBurst: int("MPP_WS_RATE_BURST", 400),
    wsMaxConnectionsPerIp: int("MPP_WS_MAX_CONNECTIONS_PER_IP", 10),
    wsBufferedAmountLimitBytes: int("MPP_WS_BUFFERED_AMOUNT_LIMIT_BYTES", 4 * 1024 * 1024),
    broadcastCellPieces: int("MPP_BROADCAST_CELL_PIECES", 16),
    broadcastMaxCells: int("MPP_BROADCAST_MAX_CELLS", 256),
    keyframeIntervalMs: int("MPP_KEYFRAME_INTERVAL_MS", 300000),
    eventWindowMs: int("MPP_EVENT_WINDOW_MS", 3000),
    interpDelayMs: int("MPP_INTERP_DELAY_MS", 6000),
    eventRetentionMs: int("MPP_EVENT_RETENTION_MS", 900000),
    keyframeIdleTtlMs: int("MPP_KEYFRAME_IDLE_TTL_MS", 15000),
    eventStartsAt: int("MPP_EVENT_STARTS_AT", 0),
    authUrl,
    authSecure: authUrl.startsWith("https:"),
    authCookieDomain: str("AUTH_COOKIE_DOMAIN", ""),
    appOrigin: str("MPP_APP_ORIGIN", defaultAppOrigin(allowedOrigins)),
    authRateMax: int("MPP_AUTH_RATE_MAX", 60),
    authRateWindowSec: int("MPP_AUTH_RATE_WINDOW_SEC", 60),
    signupMaxPerIp: int("MPP_SIGNUP_MAX_PER_IP", 10),
    signupWindowSec: int("MPP_SIGNUP_WINDOW_SEC", 3600),
    spectatorRateMax: int("MPP_SPECTATOR_RATE_MAX", 120),
    spectatorRateWindowSec: int("MPP_SPECTATOR_RATE_WINDOW_SEC", 60),
  };
}

// The SPA origin defaults to the first concrete allowed WS origin (the frontend
// is the only browser client that posts credentialed auth requests), falling
// back to the Vite dev origin when the allowlist is the wildcard.
function defaultAppOrigin(allowedOrigins: string[]): string {
  const concrete = allowedOrigins.find((o) => o !== "*");
  return concrete ?? "http://localhost:5173";
}
