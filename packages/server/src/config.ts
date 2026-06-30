import type { ImageManifest } from "@mpp/shared";
import { parseAllowedOrigins } from "./limits.js";

export const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";

// One selectable puzzle for the admin switch: a label shown in the dropdown plus
// the generation seed that must match its R2 assets. The seed is the anti-solving
// secret, so the list is configured server-side (MPP_ADMIN_PUZZLES) and only the
// id/label ever reach the browser.
export type AdminPuzzle = { id: string; label: string; seed: string };

// Boot-time overrides read from the Redis admin store (see admin.ts), used to let
// an admin puzzle switch or event-start change survive the restart it triggers.
// Each field falls back to its env value when absent.
export type ConfigOverrides = {
  puzzleId?: string;
  generationSeed?: string;
  eventStartsAt?: number;
};

export type ServerConfig = {
  port: number;
  redisUrl: string;
  mongoUrl: string;
  mongoDb: string;
  puzzleId: string;
  assetsBaseUrl: string;
  manifestUrl: string;
  manifest: ImageManifest;
  // Generation seed: drives piece geometry, the initial scatter, and the wire id
  // permutation. Server-only and never in the public manifest, so a client cannot
  // regenerate silhouettes or de-permute ids. Must match the slicer's --seed for
  // this puzzle's R2 assets (the permutation and geometry both derive from it).
  generationSeed: string;
  devEnabled: boolean;
  allowedOrigins: string[];
  wsMaxPayloadBytes: number;
  wsRateTokensPerSec: number;
  wsRateBurst: number;
  wsMaxConnectionsPerIp: number;
  wsBufferedAmountLimitBytes: number;
  // Application-level WS ping cadence. The Cloudflare proxy (once ws.* is
  // proxied) drops a WebSocket idle for ~100s, so the server pings every
  // interval and terminates a socket that missed the previous pong, keeping idle
  // contributors connected and reaping half-open sockets.
  wsHeartbeatIntervalMs: number;
  // Admission queue (see DECISIONS: admission queue). A global cap on concurrent
  // WS connections with a FIFO wait list in front of it. 0 disables the queue, so
  // the WS upgrade requires no grant (the cap is opt-in per deployment). The grant
  // TTL is how long an issued admission token holds its reserved slot before the
  // upgrade; the ticket TTL reaps a waiter that stops polling; the max queue length
  // bounds the wait list so a flood cannot grow it without limit.
  maxActiveConnections: number;
  queueGrantTtlMs: number;
  queueTicketTtlMs: number;
  maxQueueLength: number;
  // Per-IP fixed window on the queue endpoints (POST /queue/ticket, GET
  // /queue/status), sized for a waiting client's poll cadence.
  queueRateMax: number;
  queueRateWindowSec: number;
  // Spatial broadcast index (see DECISIONS: spatial broadcast index). Scoping runs
  // on the shared world grid cell (`WORLD_TILE_SIZE`); a viewport (or dragged
  // cluster) overlapping more than broadcastMaxCells cells is treated as global,
  // bounding the subscription set and the per-event cell walk.
  broadcastMaxCells: number;
  // Per-tile piece cap, as a multiple of a cell's solved density (the pieces that
  // fill one cell when solved, `(WORLD_TILE_SIZE / pieceSize)` squared). A
  // non-merging drop that would push the destination cell past this many pieces is
  // rejected, so a zoomed-out LOD tile never bakes an unbounded pile (which would
  // defeat the LOD).
  tilePieceCapMultiplier: number;
  // Absolute per-cell cap that overrides the multiplier when > 0 (a testing/ops
  // escape hatch, e.g. set it low to exercise the rejection); 0 keeps the
  // density-relative cap above.
  tilePieceCapAbsolute: number;
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
  // Shared password for the direct-URL admin page (Basic auth). Empty (the
  // default) leaves the /admin routes unmounted entirely, so the page is opt-in
  // per deployment. A secret, so it is passed through from the Coolify env, never
  // baked into the image.
  adminPassword: string;
  // Puzzles the admin switch can select. Carries each puzzle's secret seed, so it
  // is configured server-side (never baked into the committed image) and only the
  // id/label reach the browser.
  adminPuzzles: AdminPuzzle[];
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

// Parse MPP_ADMIN_PUZZLES, a JSON array of { id, seed, label? }. A malformed
// value fails the boot loudly rather than silently disabling the switch list.
function parseAdminPuzzles(raw: string | undefined): AdminPuzzle[] {
  if (!raw || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MPP_ADMIN_PUZZLES is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("MPP_ADMIN_PUZZLES must be a JSON array");
  return parsed.map((entry, i) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length === 0)
      throw new Error(`MPP_ADMIN_PUZZLES[${i}].id must be a non-empty string`);
    if (typeof e.seed !== "string" || e.seed.length === 0)
      throw new Error(`MPP_ADMIN_PUZZLES[${i}].seed must be a non-empty string`);
    const label = typeof e.label === "string" && e.label.length > 0 ? e.label : e.id;
    return { id: e.id, seed: e.seed, label };
  });
}

export async function loadConfig(overrides: ConfigOverrides = {}): Promise<ServerConfig> {
  const puzzleId = overrides.puzzleId ?? str("MPP_PUZZLE_ID");
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
  // The generation seed is the anti-solving secret, so an empty value must fail
  // the boot loudly rather than silently using a publicly derivable permutation.
  // `str` alone does not catch this: the compose `${MPP_GENERATION_SEED:-}`
  // passthrough surfaces a forgotten secret as a set-but-empty var, which `str`
  // returns as "" (its `?? fallback` only fires on undefined).
  const generationSeed = overrides.generationSeed ?? str("MPP_GENERATION_SEED");
  if (generationSeed.trim().length === 0) {
    throw new Error("MPP_GENERATION_SEED must be set (non-empty): it is the anti-solving seed");
  }
  return {
    port,
    redisUrl: str("MPP_REDIS_URL", DEFAULT_REDIS_URL),
    mongoUrl: str("MPP_MONGO_URL", "mongodb://127.0.0.1:27017"),
    mongoDb: str("MPP_MONGO_DB", "mpp"),
    puzzleId,
    assetsBaseUrl,
    manifestUrl,
    manifest,
    generationSeed,
    devEnabled: bool("MPP_DEV_ENABLED", false),
    allowedOrigins,
    wsMaxPayloadBytes: int("MPP_WS_MAX_PAYLOAD_BYTES", 64 * 1024),
    wsRateTokensPerSec: int("MPP_WS_RATE_TOKENS_PER_SEC", 200),
    wsRateBurst: int("MPP_WS_RATE_BURST", 400),
    wsMaxConnectionsPerIp: int("MPP_WS_MAX_CONNECTIONS_PER_IP", 10),
    wsBufferedAmountLimitBytes: int("MPP_WS_BUFFERED_AMOUNT_LIMIT_BYTES", 4 * 1024 * 1024),
    wsHeartbeatIntervalMs: int("MPP_WS_HEARTBEAT_INTERVAL_MS", 30000),
    maxActiveConnections: int("MPP_MAX_ACTIVE_CONNECTIONS", 0),
    queueGrantTtlMs: int("MPP_QUEUE_GRANT_TTL_MS", 10000),
    queueTicketTtlMs: int("MPP_QUEUE_TICKET_TTL_MS", 15000),
    maxQueueLength: int("MPP_MAX_QUEUE_LENGTH", 50000),
    queueRateMax: int("MPP_QUEUE_RATE_MAX", 180),
    queueRateWindowSec: int("MPP_QUEUE_RATE_WINDOW_SEC", 60),
    broadcastMaxCells: int("MPP_BROADCAST_MAX_CELLS", 256),
    tilePieceCapMultiplier: int("MPP_TILE_PIECE_CAP_MULTIPLIER", 8),
    tilePieceCapAbsolute: int("MPP_TILE_PIECE_CAP", 0),
    keyframeIntervalMs: int("MPP_KEYFRAME_INTERVAL_MS", 300000),
    eventWindowMs: int("MPP_EVENT_WINDOW_MS", 3000),
    interpDelayMs: int("MPP_INTERP_DELAY_MS", 6000),
    eventRetentionMs: int("MPP_EVENT_RETENTION_MS", 900000),
    keyframeIdleTtlMs: int("MPP_KEYFRAME_IDLE_TTL_MS", 15000),
    eventStartsAt: overrides.eventStartsAt ?? int("MPP_EVENT_STARTS_AT", 0),
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
    adminPassword: str("MPP_ADMIN_PASSWORD", ""),
    adminPuzzles: parseAdminPuzzles(process.env.MPP_ADMIN_PUZZLES),
  };
}

// The SPA origin defaults to the first concrete allowed WS origin (the frontend
// is the only browser client that posts credentialed auth requests), falling
// back to the Vite dev origin when the allowlist is the wildcard.
function defaultAppOrigin(allowedOrigins: string[]): string {
  const concrete = allowedOrigins.find((o) => o !== "*");
  return concrete ?? "http://localhost:5173";
}
