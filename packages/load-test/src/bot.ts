// One simulated client: connects, holds a local mirror of state, and runs
// a continuous grab/drag/drop loop while also emitting periodic viewport
// presence and a mouse-like cursor that tracks whatever it's about to grab
// or is currently dragging. Records latency and error counters on shared
// metrics (passed by the runner).
//
// The bot does not try to engineer snaps; drag targets are random within its
// own current viewport, so the snap/merge path is exercised only
// opportunistically. The heavy paths under load (drag fan-out, drop with
// snap detection that usually returns null) are exercised on every cycle.

import { WebSocket } from "ws";
import type {
  ClientMessage,
  QueueStatusResponse,
  QueueTicketResponse,
  ServerMessage,
} from "@mpp/shared";
import { PROTOCOL_VERSION } from "@mpp/shared";
import { World } from "./world.js";
import type { Metrics } from "./runner.js";
import type { Swarm } from "./swarm.js";

// Poll cadence while a bot waits in the admission queue past the server cap.
const QUEUE_POLL_MS = 2000;

// Fraction of the remaining distance to the target the cursor closes per
// 100ms tick while easing toward a piece it's about to grab.
const CURSOR_EASE_FRACTION = 0.25;
// Below this distance (world units) the cursor is treated as converged: stop
// sending so a genuinely resting cursor goes idle (see peerCursors.ts's bob),
// instead of resetting the receiving client's idle timer every tick forever.
const CURSOR_IDLE_EPS = 0.5;

// Drag-target sampling range beyond the bot's own current viewport, as a
// fraction of its width/height, plus a floor so the range isn't degenerate
// under a tiny --viewport-frac. Eyeballed, see DECISIONS.
const DRAG_RANGE_EXPAND = 0.5;
const DRAG_RANGE_FLOOR = 300;

export type BotConfig = {
  id: number;
  url: string;
  puzzleId: string;
  origin: string;
  // Full Cookie header value carrying this bot's seeded session, so the WS
  // upgrade's session gate accepts the connection.
  cookie: string;
  // Fraction of the play-zone span the bot's viewport covers. Kept small so the
  // viewport stays under the server's broadcast cell cap and gets a scoped
  // region_state stream (a too-large viewport is treated as a global subscriber
  // and streams no board, leaving the bot with nothing to grab).
  viewportFrac: number;
  // When set, sent as CF-Connecting-IP so the server buckets this bot under its
  // own IP (per-IP connection cap and rate bucket). Only honored when the bot
  // reaches the origin directly; Cloudflare overwrites the header at the edge.
  spoofIp: string | null;
  metrics: Metrics;
  rng: () => number;
  verbose: boolean;
  // When true, this bot biases its viewport toward the shared discovered
  // hotspot instead of a fully random one, so it stays visually grouped with
  // other clustering bots. A non-clustering bot never reads `swarm`.
  cluster: boolean;
  // Shared once per run across every bot, clustering or not: every bot
  // reports what it finds, so discovery is fast and the hotspot self-heals as
  // pieces get dragged away from it. See swarm.ts.
  swarm: Swarm;
};

export class Bot {
  private ws: WebSocket | null = null;
  private userId: string | null = null;
  private readonly world = new World();
  private heldGroupId: number | null = null;
  private dragTarget: { x: number; y: number } | null = null;
  private dragOrigin: { x: number; y: number } | null = null;
  private dragStartTime = 0;
  private dragDuration = 0;
  // Live drag position, updated every tickDrag(); the cursor snaps to this
  // while holding, since the mouse and the dragged piece are the same point.
  private dragCurrentX = 0;
  private dragCurrentY = 0;
  // The bot's own current viewport rect, set at the end of sendViewport();
  // beginDrag() samples its drag target from it instead of the whole play zone.
  private viewportX = 0;
  private viewportY = 0;
  private viewportW = 0;
  private viewportH = 0;
  // Current cursor position and where it's easing toward while not holding.
  private cursorX = 0;
  private cursorY = 0;
  private cursorTargetX = 0;
  private cursorTargetY = 0;
  private cursorInitialized = false;
  private readonly pendingGrabs = new Map<number, number>();
  private cycleTimer: NodeJS.Timeout | null = null;
  private viewportTimer: NodeJS.Timeout | null = null;
  private cursorTimer: NodeJS.Timeout | null = null;
  private dragTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly cfg: BotConfig) {}

  async start(): Promise<void> {
    let grant: string | null;
    try {
      grant = await this.admit();
    } catch (e) {
      this.cfg.metrics.wsErrors.inc();
      if (this.cfg.verbose)
        console.error(`[bot ${this.cfg.id}] admit error: ${(e as Error).message}`);
      return;
    }
    if (this.stopped) return;
    this.openWs(grant);
  }

  // Acquire an admission grant before connecting: request a ticket, then poll while
  // queued until a slot frees. Returns the grant token, or null when the server has
  // no cap (connect ungated). Mirrors the browser client so a capped server queues
  // bots past the cap exactly as it would real players.
  private async admit(): Promise<string | null> {
    const base = httpBaseFromWs(this.cfg.url);
    const headers: Record<string, string> = {};
    if (this.cfg.spoofIp) headers["CF-Connecting-IP"] = this.cfg.spoofIp;
    let ticket: string | null = null;
    while (!this.stopped) {
      const res =
        ticket === null
          ? await fetch(`${base}/queue/ticket`, { method: "POST", headers })
          : await fetch(`${base}/queue/status?ticket=${encodeURIComponent(ticket)}`, { headers });
      if (!res.ok) throw new Error(`queue ${res.status}`);
      const body = (await res.json()) as QueueTicketResponse | QueueStatusResponse;
      if (body.state === "disabled") return null;
      if (body.state === "ready") return body.grant;
      if (body.state === "queued") {
        ticket = body.ticket;
        if (this.cfg.verbose)
          console.log(`[bot ${this.cfg.id}] queued at position ${body.position}`);
        await delay(QUEUE_POLL_MS);
        continue;
      }
      // busy (wait list full) or expired (ticket reaped): re-request a ticket.
      ticket = null;
      if (body.state === "busy") await delay(QUEUE_POLL_MS);
    }
    return null;
  }

  private openWs(grant: string | null): void {
    const url = grant ? appendGrant(this.cfg.url, grant) : this.cfg.url;
    const headers: Record<string, string> = { Origin: this.cfg.origin, Cookie: this.cfg.cookie };
    if (this.cfg.spoofIp) headers["CF-Connecting-IP"] = this.cfg.spoofIp;
    const ws = new WebSocket(url, { headers });
    this.ws = ws;
    ws.on("open", () => {
      this.send({ t: "hello", protocolVersion: PROTOCOL_VERSION, puzzleId: this.cfg.puzzleId });
    });
    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const raw = Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString("utf8")
          : data.toString("utf8");
      this.onMessage(raw);
    });
    ws.on("error", (e) => {
      this.cfg.metrics.wsErrors.inc();
      if (this.cfg.verbose) console.error(`[bot ${this.cfg.id}] ws error: ${e.message}`);
    });
    ws.on("close", (code) => {
      this.cfg.metrics.wsCloses.inc();
      if (code === 1013) this.cfg.metrics.backpressureCloses.inc();
      this.shutdown();
    });
  }

  stop(): void {
    this.shutdown();
    this.ws?.close();
  }

  private shutdown(): void {
    this.stopped = true;
    if (this.cycleTimer) clearTimeout(this.cycleTimer);
    if (this.viewportTimer) clearInterval(this.viewportTimer);
    if (this.cursorTimer) clearInterval(this.cursorTimer);
    if (this.dragTimer) clearInterval(this.dragTimer);
  }

  private send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      this.cfg.metrics.wsErrors.inc();
    }
  }

  private onMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.t) {
      case "welcome":
        this.userId = msg.userId;
        this.world.playZone = msg.playZone;
        // Protocol v4: no board arrives on join. Start the viewport/cursor
        // presence and the grab loop now; the board fills in from the
        // region_state stream the first viewport triggers.
        this.startTimers();
        return;
      case "region_state":
        this.world.applyRegionState(msg);
        this.reportHotspot(msg.groups);
        return;
      case "grab_ok": {
        this.world.applyGrabOk(msg);
        const sentAt = this.pendingGrabs.get(msg.groupId);
        if (sentAt === undefined) return;
        this.pendingGrabs.delete(msg.groupId);
        if (msg.userId === this.userId) {
          this.cfg.metrics.grabOk.inc();
          this.cfg.metrics.grabLatency.observe(Date.now() - sentAt);
          this.beginDrag(msg.groupId);
        } else {
          this.cfg.metrics.grabRaceLost.inc();
          this.scheduleNextCycle(20);
        }
        return;
      }
      case "grab_denied":
        if (this.pendingGrabs.delete(msg.groupId)) {
          this.cfg.metrics.grabDenied.inc();
          this.scheduleNextCycle(20);
        }
        return;
      case "drag":
        this.world.applyDrag(msg);
        return;
      case "drop":
        this.world.applyDrop(msg);
        return;
      case "snap":
        this.world.applySnap(msg);
        if (this.heldGroupId !== null) {
          const g = this.world.groups.get(this.heldGroupId);
          if (!g || g.heldBy !== this.userId) {
            this.endDrag();
            this.scheduleNextCycle(50);
          }
        }
        return;
      case "error":
        this.cfg.metrics.serverErrors.inc();
        if (this.cfg.verbose)
          console.warn(`[bot ${this.cfg.id}] server error ${msg.code}: ${msg.message}`);
        return;
      default:
        return;
    }
  }

  // A client can't know piece positions a priori (see DECISIONS: anti-
  // programmatic-solving), so the hotspot has to come from a bot actually
  // looking. Early on (board mostly loose) any bot's viewport has something in
  // it, so a non-clustering bot may only seed the very first hotspot; once one
  // exists, only clustering bots keep it fresh. Early testing showed that
  // letting every bot report unconditionally let the 6 independent-scatter
  // bots (uniformly random across the whole board) overwrite the hotspot with
  // an unrelated sighting on almost every tick, so the clustering bots never
  // got a stable point to converge on: the swarm just chased whichever bot
  // last happened to glance somewhere. Restricting ongoing updates to the
  // clustering subset keeps drift local (their own viewport jitter, or a
  // piece genuinely dragged out of the area) instead of board-wide teleports.
  private reportHotspot(groups: { worldX: number; worldY: number }[]): void {
    if (groups.length === 0) return;
    if (!this.cfg.cluster && this.cfg.swarm.get() !== null) return;
    let sx = 0;
    let sy = 0;
    for (const g of groups) {
      sx += g.worldX;
      sy += g.worldY;
    }
    const cx = sx / groups.length;
    const cy = sy / groups.length;
    if (this.cfg.swarm.report(cx, cy)) {
      console.log(`[swarm] hotspot found near (${cx.toFixed(0)}, ${cy.toFixed(0)})`);
    }
  }

  private startTimers(): void {
    this.scheduleNextCycle(50 + Math.floor(this.cfg.rng() * 200));
    this.viewportTimer = setInterval(() => this.sendViewport(), 1000);
    this.sendViewport();
    this.cursorTimer = setInterval(() => this.tickCursor(), 100);
  }

  private scheduleNextCycle(delayMs: number): void {
    if (this.stopped) return;
    if (this.cycleTimer) clearTimeout(this.cycleTimer);
    this.cycleTimer = setTimeout(() => this.cycle(), delayMs);
  }

  private cycle(): void {
    if (this.stopped) return;
    const g = this.world.pickFreeGroup(this.cfg.rng);
    if (!g) {
      this.scheduleNextCycle(200);
      return;
    }
    // The cursor starts easing toward the piece the instant the bot decides
    // to grab it, same as it would for a real click.
    this.cursorTargetX = g.worldX;
    this.cursorTargetY = g.worldY;
    this.pendingGrabs.set(g.id, Date.now());
    this.cfg.metrics.grabSent.inc();
    this.send({ t: "grab", groupId: g.id });
    setTimeout(() => {
      if (this.stopped) return;
      if (this.pendingGrabs.delete(g.id)) {
        this.cfg.metrics.grabTimeouts.inc();
        this.scheduleNextCycle(0);
      }
    }, 5000);
  }

  private beginDrag(groupId: number): void {
    const g = this.world.groups.get(groupId);
    if (!g) {
      this.endDrag();
      this.scheduleNextCycle(50);
      return;
    }
    this.heldGroupId = groupId;
    const z = this.world.playZone;
    // Sample the drag target within the bot's own current viewport (expanded
    // slightly), not the whole play zone: keeps a clustered piece from flying
    // off across the board mid-drag, and is more realistic on its own too
    // (nobody drags a piece the width of a 1M-piece board in one motion).
    const padX = Math.max(this.viewportW * DRAG_RANGE_EXPAND, DRAG_RANGE_FLOOR);
    const padY = Math.max(this.viewportH * DRAG_RANGE_EXPAND, DRAG_RANGE_FLOOR);
    const minX = clamp(this.viewportX - padX, z.minX, z.maxX);
    const maxX = clamp(this.viewportX + this.viewportW + padX, z.minX, z.maxX);
    const minY = clamp(this.viewportY - padY, z.minY, z.maxY);
    const maxY = clamp(this.viewportY + this.viewportH + padY, z.minY, z.maxY);
    const targetX = minX + this.cfg.rng() * Math.max(0, maxX - minX);
    const targetY = minY + this.cfg.rng() * Math.max(0, maxY - minY);
    this.dragTarget = { x: targetX, y: targetY };
    this.dragOrigin = { x: g.worldX, y: g.worldY };
    this.dragStartTime = Date.now();
    this.dragDuration = 1000 + Math.floor(this.cfg.rng() * 2000);
    if (this.dragTimer) clearInterval(this.dragTimer);
    this.dragTimer = setInterval(() => this.tickDrag(), 16);
  }

  private tickDrag(): void {
    if (this.heldGroupId === null || !this.dragTarget || !this.dragOrigin) return;
    const elapsed = Date.now() - this.dragStartTime;
    const t = Math.min(1, elapsed / this.dragDuration);
    const jx = (this.cfg.rng() - 0.5) * 2;
    const jy = (this.cfg.rng() - 0.5) * 2;
    const x = this.dragOrigin.x + (this.dragTarget.x - this.dragOrigin.x) * t + jx;
    const y = this.dragOrigin.y + (this.dragTarget.y - this.dragOrigin.y) * t + jy;
    this.dragCurrentX = x;
    this.dragCurrentY = y;
    this.send({ t: "drag", groupId: this.heldGroupId, worldX: x, worldY: y });
    this.cfg.metrics.dragsSent.inc();
    if (t >= 1) {
      const groupId = this.heldGroupId;
      const dropX = this.dragTarget.x;
      const dropY = this.dragTarget.y;
      this.send({ t: "drop", groupId, worldX: dropX, worldY: dropY });
      this.cfg.metrics.dropsSent.inc();
      this.endDrag();
      this.scheduleNextCycle(100 + Math.floor(this.cfg.rng() * 400));
    }
  }

  private endDrag(): void {
    if (this.dragTimer) {
      clearInterval(this.dragTimer);
      this.dragTimer = null;
    }
    this.heldGroupId = null;
    this.dragTarget = null;
    this.dragOrigin = null;
  }

  private sendViewport(): void {
    this.world.resetForNewViewport(this.heldGroupId);
    const z = this.world.playZone;
    const w = (z.maxX - z.minX) * this.cfg.viewportFrac;
    const h = (z.maxY - z.minY) * this.cfg.viewportFrac;
    const hotspot = this.cfg.cluster ? this.cfg.swarm.get() : null;
    let x: number;
    let y: number;
    if (hotspot) {
      // Center near the hotspot plus jitter of roughly one viewport-width, so
      // clustering bots spread across a human-watchable area instead of
      // stacking on one exact point.
      const jitterX = (this.cfg.rng() - 0.5) * 2 * w;
      const jitterY = (this.cfg.rng() - 0.5) * 2 * h;
      x = clamp(hotspot.x - w / 2 + jitterX, z.minX, Math.max(z.minX, z.maxX - w));
      y = clamp(hotspot.y - h / 2 + jitterY, z.minY, Math.max(z.minY, z.maxY - h));
    } else {
      x = z.minX + this.cfg.rng() * Math.max(0, z.maxX - z.minX - w);
      y = z.minY + this.cfg.rng() * Math.max(0, z.maxY - z.minY - h);
    }
    this.viewportX = x;
    this.viewportY = y;
    this.viewportW = w;
    this.viewportH = h;
    if (!this.cursorInitialized) {
      this.cursorX = x + w / 2;
      this.cursorY = y + h / 2;
      this.cursorTargetX = this.cursorX;
      this.cursorTargetY = this.cursorY;
      this.cursorInitialized = true;
    }
    this.send({ t: "viewport", worldX: x, worldY: y, worldW: w, worldH: h });
  }

  private tickCursor(): void {
    if (this.heldGroupId !== null) {
      // Mouse = dragged piece, exactly like a real client's drag. Keep the
      // idle-ease target pinned to the same point throughout the hold, so the
      // instant the drag ends the cursor has zero pending motion instead of
      // jumping back toward wherever this piece started (cursorTarget was
      // last set to the pre-grab pickup point, back in cycle()).
      this.cursorX = this.dragCurrentX;
      this.cursorY = this.dragCurrentY;
      this.cursorTargetX = this.cursorX;
      this.cursorTargetY = this.cursorY;
      this.send({ t: "cursor", worldX: this.cursorX, worldY: this.cursorY });
      return;
    }
    const dx = this.cursorTargetX - this.cursorX;
    const dy = this.cursorTargetY - this.cursorY;
    if (Math.abs(dx) < CURSOR_IDLE_EPS && Math.abs(dy) < CURSOR_IDLE_EPS) {
      // Converged: rest silently instead of re-sending an unchanged position,
      // so a genuinely idle bot lets peerCursors.ts's own idle bob kick in
      // rather than looking permanently frozen mid-motion.
      return;
    }
    this.cursorX += dx * CURSOR_EASE_FRACTION;
    this.cursorY += dy * CURSOR_EASE_FRACTION;
    this.send({ t: "cursor", worldX: this.cursorX, worldY: this.cursorY });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

// HTTP origin of the queue endpoints, derived from the WS url (ws->http,
// wss->https), at the host root regardless of the WS path.
function httpBaseFromWs(wsUrl: string): string {
  const u = new URL(wsUrl);
  const scheme = u.protocol === "wss:" ? "https:" : "http:";
  return `${scheme}//${u.host}`;
}

function appendGrant(wsUrl: string, grant: string): string {
  const u = new URL(wsUrl);
  u.searchParams.set("grant", grant);
  return u.toString();
}
