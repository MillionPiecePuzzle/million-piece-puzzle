// One simulated client: connects, holds a local mirror of state, and runs
// a continuous grab/drag/drop loop while also emitting periodic viewport
// and cursor presence. Records latency and error counters on shared
// metrics (passed by the runner).
//
// The bot does not try to engineer snaps; targets are random within the
// play zone, so the snap/merge path is exercised only opportunistically.
// The heavy paths under load (drag fan-out, drop with snap detection that
// usually returns null) are exercised on every cycle.

import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@mpp/shared";
import { PROTOCOL_VERSION } from "@mpp/shared";
import { World } from "./world.js";
import type { Metrics } from "./runner.js";

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
  metrics: Metrics;
  rng: () => number;
  verbose: boolean;
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
  private readonly pendingGrabs = new Map<number, number>();
  private cycleTimer: NodeJS.Timeout | null = null;
  private viewportTimer: NodeJS.Timeout | null = null;
  private cursorTimer: NodeJS.Timeout | null = null;
  private dragTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly cfg: BotConfig) {}

  start(): void {
    const ws = new WebSocket(this.cfg.url, {
      headers: { Origin: this.cfg.origin, Cookie: this.cfg.cookie },
    });
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

  private startTimers(): void {
    this.scheduleNextCycle(50 + Math.floor(this.cfg.rng() * 200));
    this.viewportTimer = setInterval(() => this.sendViewport(), 1000);
    this.sendViewport();
    this.cursorTimer = setInterval(() => this.sendCursor(), 100);
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
    const targetX = z.minX + this.cfg.rng() * (z.maxX - z.minX);
    const targetY = z.minY + this.cfg.rng() * (z.maxY - z.minY);
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
    const z = this.world.playZone;
    const w = (z.maxX - z.minX) * this.cfg.viewportFrac;
    const h = (z.maxY - z.minY) * this.cfg.viewportFrac;
    const x = z.minX + this.cfg.rng() * Math.max(0, z.maxX - z.minX - w);
    const y = z.minY + this.cfg.rng() * Math.max(0, z.maxY - z.minY - h);
    this.send({ t: "viewport", worldX: x, worldY: y, worldW: w, worldH: h });
  }

  private sendCursor(): void {
    const z = this.world.playZone;
    const x = z.minX + this.cfg.rng() * (z.maxX - z.minX);
    const y = z.minY + this.cfg.rng() * (z.maxY - z.minY);
    this.send({ t: "cursor", worldX: x, worldY: y });
  }
}
