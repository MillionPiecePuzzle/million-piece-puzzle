import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "@mpp/shared";

export type WsListener = (msg: ServerMessage) => void;
export type WsCloseListener = (info: { intentional: boolean }) => void;

export class PuzzleWsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<WsListener>();
  private closeListeners = new Set<WsCloseListener>();
  private intentionalClose = false;

  constructor(
    private readonly url: string,
    private readonly puzzleId: string,
  ) {}

  connect(): void {
    if (this.ws) return;
    this.intentionalClose = false;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.send({ t: "hello", protocolVersion: PROTOCOL_VERSION, puzzleId: this.puzzleId });
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
    ws.addEventListener("close", () => {
      this.ws = null;
      const intentional = this.intentionalClose;
      for (const l of this.closeListeners) l({ intentional });
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
