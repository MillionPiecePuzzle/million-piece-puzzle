import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  ActivityItem,
  LeaderboardEntry,
  PlayZone,
  SpectatorEvent,
  SpectatorKeyframe,
} from "@mpp/shared";
import { SPECTATOR_FORMAT_VERSION } from "@mpp/shared";
import type { RedisState } from "./state.js";
import type { EventLog } from "./eventLog.js";

export type KeyframeSource = {
  puzzleId: () => string;
  totalPieces: () => number;
  playZone: () => PlayZone;
  eventStartsAt: () => number;
  // Current puzzle status, read live (reset reassigns ctx.meta), so the idle gate
  // and the keyframe `live` flag always reflect the latest lifecycle state.
  status: () => "active" | "completed";
  state: RedisState;
  eventLog: EventLog;
  leaderboard: () => Promise<LeaderboardEntry[]>;
  activity: () => Promise<ActivityItem[]>;
  windowMs: number;
  delayMs: number;
};

// The board read is off the per-group dispatch queue and `readAllPieces` /
// `readAllGroups` are independent pipelines (not a MULTI), so the keyframe can
// capture a merge mid-apply: a piece reassigned before its group is repositioned,
// or pointing at a deleted group (see DECISIONS: keyframe reads off the write
// queue). That artifact is cosmetic and now healed twice over: by the next event
// window the client replays, and by the next keyframe. The `cursor` is read
// before the board so it is a lower bound on the board's logical time: any event
// that already affected the board but lands after `cursor` is simply replayed by
// the client (drops and snaps are idempotent on an already-applied state), which
// is the safe direction (replay, never miss).
export async function buildKeyframe(
  source: KeyframeSource,
  live: boolean,
): Promise<SpectatorKeyframe> {
  const puzzleId = source.puzzleId();
  const totalPieces = source.totalPieces();
  const cursor = await source.eventLog.head();
  const [pieces, groups, lockedCount, leaderboard, activity] = await Promise.all([
    source.state.readAllPieces(totalPieces),
    source.state.readAllGroups(totalPieces),
    source.state.getLockedCount(),
    source.leaderboard(),
    source.activity(),
  ]);
  return {
    v: SPECTATOR_FORMAT_VERSION,
    puzzleId,
    generatedAt: Date.now(),
    cursor,
    windowMs: source.windowMs,
    delayMs: source.delayMs,
    live,
    lockedCount,
    totalPieces,
    playZone: source.playZone(),
    eventStartsAt: source.eventStartsAt(),
    pieces,
    groups,
    leaderboard,
    activity,
  };
}

// In-memory publisher: a ticker regenerates the keyframe on a fixed interval and
// the HTTP handler serves the last successful body. A regeneration failure keeps
// the previous body served, so a transient Redis hiccup never produces a 5xx.
//
// Idle gate: a tick regenerates only while the event is live (status active and
// past eventStartsAt). Before the start and after completion the publisher
// freezes on its last body and does zero full-board reads; the spectator detects
// the same states from eventStartsAt + lockedCount and stops tailing windows. One
// body is built at boot regardless (force) so a pre-event spectator still gets
// the scattered board, and a reset/complete transition forces a fresh body so the
// frozen keyframe reflects it immediately.
export class KeyframePublisher {
  private latestBody: string | null = null;
  private latestKeyframe: SpectatorKeyframe | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private regenerating = false;

  constructor(
    private readonly intervalMs: number,
    private readonly source: KeyframeSource,
  ) {}

  isLive(): boolean {
    const startsAt = this.source.eventStartsAt();
    return this.source.status() === "active" && (startsAt === 0 || Date.now() >= startsAt);
  }

  start(): void {
    if (this.timer) return;
    void this.regenerate(true);
    this.timer = setInterval(() => {
      void this.regenerate();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  latest(): { body: string; keyframe: SpectatorKeyframe } | null {
    if (this.latestBody === null || this.latestKeyframe === null) return null;
    return { body: this.latestBody, keyframe: this.latestKeyframe };
  }

  async regenerate(force = false): Promise<void> {
    if (this.regenerating) return;
    // Skip the Redis read and keep the last body when not live, unless forced or
    // no body exists yet (boot).
    if (!force && this.latestBody !== null && !this.isLive()) return;
    this.regenerating = true;
    try {
      const kf = await buildKeyframe(this.source, this.isLive());
      this.latestKeyframe = kf;
      this.latestBody = JSON.stringify(kf);
    } catch (e) {
      console.error("[keyframe] regenerate failed:", (e as Error).message);
    } finally {
      this.regenerating = false;
    }
  }
}

const CORS = { "Access-Control-Allow-Origin": "*" } as const;

function handlePreflightOrMethod(req: IncomingMessage, res: ServerResponse): boolean | "ok" {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...CORS,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return true;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { ...CORS, Allow: "GET, HEAD, OPTIONS" });
    res.end();
    return true;
  }
  return "ok";
}

// HTTP handler for GET /keyframe. Serves the cached body with a Cache-Control
// matched to liveness: a live body changes each interval (long max-age), a frozen
// one (pre-event / completed) gets a short max-age so a reset/complete/start
// transition is picked up by the edge promptly. CORS is wildcard so the edge
// caches a single body for all callers (Cloudflare Free does not honor `Vary:
// Origin`); the WS Origin allowlist is unrelated and stays strict.
export function makeKeyframeHandler(
  publisher: KeyframePublisher,
  opts: { intervalMs: number; idleTtlMs: number },
) {
  const liveMaxAge = Math.max(1, Math.floor(opts.intervalMs / 1000));
  const idleMaxAge = Math.max(1, Math.floor(opts.idleTtlMs / 1000));

  return function handle(req: IncomingMessage, res: ServerResponse): boolean {
    const path = (req.url ?? "").split("?", 1)[0];
    if (path !== "/keyframe") return false;
    const pre = handlePreflightOrMethod(req, res);
    if (pre === true) return true;

    const latest = publisher.latest();
    if (!latest) {
      res.writeHead(503, {
        ...CORS,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : '{"error":"keyframe_not_ready"}');
      return true;
    }
    const maxAge = latest.keyframe.live ? liveMaxAge : idleMaxAge;
    res.writeHead(200, {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
      "Content-Length": Buffer.byteLength(latest.body).toString(),
    });
    res.end(req.method === "HEAD" ? undefined : latest.body);
    return true;
  };
}

const EVENTS_PREFIX = "/events/";

// HTTP handler for GET /events/<t0>. Addresses immutable wall-clock windows:
// rejects a non-W-aligned t0 (400), a not-yet-sealed window (425) and an
// out-of-retention window (404) before any Redis read, so origin work is bounded
// and only sealed, in-range windows reach Redis or the cache. A sealed window is
// immutable, so it is served with a one-year immutable Cache-Control and the
// wildcard CORS the keyframe uses.
export function makeEventsHandler(opts: {
  eventLog: EventLog;
  windowMs: number;
  retentionMs: number;
  now?: () => number;
}) {
  const W = opts.windowMs;
  const now = opts.now ?? (() => Date.now());

  function reject(res: ServerResponse, status: number, error: string, isHead: boolean): void {
    res.writeHead(status, {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(isHead ? undefined : JSON.stringify({ error }));
  }

  return function handle(req: IncomingMessage, res: ServerResponse): boolean {
    const path = (req.url ?? "").split("?", 1)[0] ?? "";
    if (!path.startsWith(EVENTS_PREFIX)) return false;
    const pre = handlePreflightOrMethod(req, res);
    if (pre === true) return true;
    const isHead = req.method === "HEAD";

    const t0 = Number(path.slice(EVENTS_PREFIX.length));
    if (!Number.isInteger(t0) || t0 < 0 || t0 % W !== 0) {
      reject(res, 400, "misaligned_window", isHead);
      return true;
    }
    const t = now();
    if (t < t0 + W) {
      // Too Early: the window is still open, so it is not yet immutable.
      reject(res, 425, "window_not_sealed", isHead);
      return true;
    }
    if (t0 < t - opts.retentionMs) {
      reject(res, 404, "window_out_of_retention", isHead);
      return true;
    }

    void (async () => {
      try {
        const events: SpectatorEvent[] = await opts.eventLog.readWindow(t0, W);
        const body = JSON.stringify({ v: SPECTATOR_FORMAT_VERSION, t0, windowMs: W, events });
        res.writeHead(200, {
          ...CORS,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": Buffer.byteLength(body).toString(),
        });
        res.end(isHead ? undefined : body);
      } catch (e) {
        console.error("[events] read failed:", (e as Error).message);
        reject(res, 500, "server", isHead);
      }
    })();
    return true;
  };
}
