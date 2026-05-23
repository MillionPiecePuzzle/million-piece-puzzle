import type { IncomingMessage, ServerResponse } from "node:http";
import type { PlayZone, Snapshot } from "@mpp/shared";
import type { RedisState } from "./state.js";

export type SnapshotSource = {
  puzzleId: () => string;
  totalPieces: () => number;
  playZone: () => PlayZone;
  state: RedisState;
};

export async function buildSnapshot(source: SnapshotSource): Promise<Snapshot> {
  const puzzleId = source.puzzleId();
  const totalPieces = source.totalPieces();
  const [pieces, groups, lockedCount] = await Promise.all([
    source.state.readAllPieces(totalPieces),
    source.state.readAllGroups(totalPieces),
    source.state.getLockedCount(),
  ]);
  return {
    puzzleId,
    generatedAt: Date.now(),
    lockedCount,
    totalPieces,
    playZone: source.playZone(),
    pieces,
    groups,
  };
}

// In-memory publisher: a ticker regenerates the snapshot on a fixed interval
// and the HTTP handler serves the last successful body. A regeneration failure
// keeps the previous snapshot served, so a transient Redis hiccup never
// produces a 5xx. The `generatedAt` field lets callers see how stale it is.
export class SnapshotPublisher {
  private latestBody: string | null = null;
  private latestSnapshot: Snapshot | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private regenerating = false;

  constructor(
    private readonly intervalMs: number,
    private readonly source: SnapshotSource,
  ) {}

  start(): void {
    if (this.timer) return;
    void this.regenerate();
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

  latest(): { body: string; snapshot: Snapshot } | null {
    if (this.latestBody === null || this.latestSnapshot === null) return null;
    return { body: this.latestBody, snapshot: this.latestSnapshot };
  }

  async regenerate(): Promise<void> {
    if (this.regenerating) return;
    this.regenerating = true;
    try {
      const snap = await buildSnapshot(this.source);
      this.latestSnapshot = snap;
      this.latestBody = JSON.stringify(snap);
    } catch (e) {
      console.error("[snapshot] regenerate failed:", (e as Error).message);
    } finally {
      this.regenerating = false;
    }
  }
}

// HTTP request handler for GET /snapshot. 200 with the cached JSON body when a
// snapshot is available, 503 before the first successful regeneration, 404
// for any other path, 405 for non-GET. The Cache-Control header is tuned to
// the publisher cadence so a Cloudflare edge cache front of this endpoint
// absorbs spectator traffic with a stale-tolerance equal to one tick.
//
// CORS: spectator clients are served from a different origin
// (app.millionpiecepuzzle.com) than the WS host. With a wildcard allowlist the
// response carries `Access-Control-Allow-Origin: *` so the CDN can cache one
// body for all callers; with a specific allowlist the request Origin is
// echoed when it matches, and a `Vary: Origin` is added (Cloudflare's free
// plan does not honor Vary for caching, so prefer `*` when the snapshot is
// fronted by the edge).
export function makeSnapshotHandler(
  publisher: SnapshotPublisher,
  intervalMs: number,
  allowedOrigins: string[] = ["*"],
) {
  const cacheSeconds = Math.max(1, Math.floor(intervalMs / 1000));
  const cacheControl = `public, max-age=${cacheSeconds}`;
  const wildcard = allowedOrigins.length === 1 && allowedOrigins[0] === "*";

  function corsFor(origin: string | undefined): Record<string, string> {
    if (wildcard) return { "Access-Control-Allow-Origin": "*" };
    if (origin && allowedOrigins.includes(origin)) {
      return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
    }
    return {};
  }

  return function handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = req.url ?? "";
    const path = url.split("?", 1)[0];
    if (path !== "/snapshot") return false;
    const origin = req.headers?.origin;
    const cors = corsFor(typeof origin === "string" ? origin : undefined);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...cors,
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return true;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...cors, Allow: "GET, HEAD, OPTIONS" });
      res.end();
      return true;
    }
    const latest = publisher.latest();
    if (!latest) {
      res.writeHead(503, {
        ...cors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : '{"error":"snapshot_not_ready"}');
      return true;
    }
    res.writeHead(200, {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "Content-Length": Buffer.byteLength(latest.body).toString(),
    });
    res.end(req.method === "HEAD" ? undefined : latest.body);
    return true;
  };
}
