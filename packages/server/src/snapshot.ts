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
export function makeSnapshotHandler(publisher: SnapshotPublisher, intervalMs: number) {
  const cacheSeconds = Math.max(1, Math.floor(intervalMs / 1000));
  const cacheControl = `public, max-age=${cacheSeconds}`;
  return function handle(req: IncomingMessage, res: ServerResponse): boolean {
    const url = req.url ?? "";
    const path = url.split("?", 1)[0];
    if (path !== "/snapshot") return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return true;
    }
    const latest = publisher.latest();
    if (!latest) {
      res.writeHead(503, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : '{"error":"snapshot_not_ready"}');
      return true;
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl,
      "Content-Length": Buffer.byteLength(latest.body).toString(),
    });
    res.end(req.method === "HEAD" ? undefined : latest.body);
    return true;
  };
}
