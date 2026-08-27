import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "@mpp/shared";

export type WsListener = (msg: ServerMessage) => void;

// What the connection looked like when it went away. `code` is the WebSocket
// close code, so a caller can tell a deliberate server restart (1012) from any
// other drop; the rest is diagnostic and only ever reaches the console.
export type WsCloseInfo = {
  intentional: boolean;
  code: number;
  reason: string;
  wasClean: boolean;
  ageMs: number;
  // Longest stretch the page's main thread went unserviced while the socket was
  // open. A foreground tab reports about one tick, a backgrounded one about a
  // minute (timers are throttled there), and a frozen or suspended one the whole
  // time the player was away. That is what separates a socket the browser
  // stopped servicing from a genuine network fault.
  stalledMs: number;
  hidden: boolean;
};
export type WsCloseListener = (info: WsCloseInfo) => void;

const ACTIVITY_TICK_MS = 5_000;

export class PuzzleWsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<WsListener>();
  private closeListeners = new Set<WsCloseListener>();
  private intentionalClose = false;
  private connectedAt = 0;
  private activityTimer: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private worstStallMs = 0;

  constructor(private readonly url: string) {}

  connect(): void {
    if (this.ws) return;
    this.intentionalClose = false;
    this.connectedAt = Date.now();
    this.startActivityWatch();
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      // The server holds a single puzzle and tells us its id in welcome. The
      // puzzleId in hello is informational only.
      this.send({ t: "hello", protocolVersion: PROTOCOL_VERSION, puzzleId: "*" });
    });
    ws.addEventListener("message", (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerMessage;
      } catch {
        return;
      }
      for (const l of this.listeners) l(msg);
    });
    ws.addEventListener("close", (ev) => {
      this.ws = null;
      this.stopActivityWatch();
      const now = Date.now();
      const info: WsCloseInfo = {
        intentional: this.intentionalClose,
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
        ageMs: now - this.connectedAt,
        // A tab coming back from a freeze delivers this event and the overdue
        // tick in no fixed order, so take whichever of the two saw the gap.
        stalledMs: Math.max(this.worstStallMs, now - this.lastTickAt),
        hidden: document.visibilityState === "hidden",
      };
      for (const l of this.closeListeners) l(info);
    });
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  on(listener: WsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: WsCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    this.intentionalClose = true;
    this.ws?.close();
    this.ws = null;
  }

  private startActivityWatch(): void {
    this.stopActivityWatch();
    this.lastTickAt = Date.now();
    this.worstStallMs = 0;
    this.activityTimer = setInterval(() => {
      const now = Date.now();
      this.worstStallMs = Math.max(this.worstStallMs, now - this.lastTickAt);
      this.lastTickAt = now;
    }, ACTIVITY_TICK_MS);
  }

  private stopActivityWatch(): void {
    if (this.activityTimer === null) return;
    clearInterval(this.activityTimer);
    this.activityTimer = null;
  }
}
