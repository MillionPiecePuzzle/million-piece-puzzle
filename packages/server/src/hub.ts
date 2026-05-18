import type { WebSocket } from "ws";
import type { ServerMessage } from "@mpp/shared";
import type { TokenBucket } from "./limits.js";

export type Client = {
  userId: string;
  ws: WebSocket;
  bucket: TokenBucket;
};

// WebSocket close code 1013 ("Try Again Later") for slow consumers whose
// outbound buffer has grown past the configured limit.
const CLOSE_TRY_AGAIN_LATER = 1013;

export class Hub {
  private readonly clients = new Set<Client>();

  constructor(private readonly bufferedAmountLimitBytes: number) {}

  add(client: Client): void {
    this.clients.add(client);
  }

  remove(client: Client): void {
    this.clients.delete(client);
  }

  send(client: Client, msg: ServerMessage): void {
    this.write(client, JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage, except?: Client): void {
    const payload = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c === except) continue;
      this.write(c, payload);
    }
  }

  private write(client: Client, payload: string): void {
    const ws = client.ws;
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > this.bufferedAmountLimitBytes) {
      // Slow consumer: closing prevents unbounded memory growth on the writer
      // and forces the client to reconnect and resync from a clean snapshot.
      ws.close(CLOSE_TRY_AGAIN_LATER, "slow consumer");
      return;
    }
    ws.send(payload);
  }

  allClients(): Client[] {
    return [...this.clients];
  }
}
