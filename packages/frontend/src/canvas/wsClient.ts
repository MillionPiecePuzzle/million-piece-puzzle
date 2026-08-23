import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "@mpp/shared";

export type WsListener = (msg: ServerMessage) => void;
// `code` is the WebSocket close code, so a caller can tell a deliberate server
// restart (1012) from any other drop.
export type WsCloseListener = (info: { intentional: boolean; code: number }) => void;

export class PuzzleWsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<WsListener>();
  private closeListeners = new Set<WsCloseListener>();
  private intentionalClose = false;

  constructor(private readonly url: string) {}

  connect(): void {
    if (this.ws) return;
    this.intentionalClose = false;
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
      const intentional = this.intentionalClose;
      for (const l of this.closeListeners) l({ intentional, code: ev.code });
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
}
