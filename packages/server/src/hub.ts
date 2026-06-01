import type { WebSocket } from "ws";
import type { ServerMessage } from "@mpp/shared";
import type { TokenBucket } from "./limits.js";

// Visible world rectangle last reported by a client, used to scope drag and
// drop broadcasts. Width and height are non-negative.
export type Viewport = {
  worldX: number;
  worldY: number;
  worldW: number;
  worldH: number;
};

export type Client = {
  userId: string;
  ws: WebSocket;
  bucket: TokenBucket;
  // null until the client's first `viewport` message. A client with no known
  // viewport receives every drag and drop broadcast, so scoping never silently
  // cuts off a client that has not yet reported one.
  viewport: Viewport | null;
  // The authenticated user's profile pseudo, resolved at the WS upgrade and
  // fixed for the connection, null when the user has not set one yet.
  pseudo: string | null;
};

// WebSocket close code 1013 ("Try Again Later") for slow consumers whose
// outbound buffer has grown past the configured limit.
const CLOSE_TRY_AGAIN_LATER = 1013;

function viewportContains(viewport: Viewport | null, worldX: number, worldY: number): boolean {
  if (viewport === null) return true;
  return (
    worldX >= viewport.worldX &&
    worldX <= viewport.worldX + viewport.worldW &&
    worldY >= viewport.worldY &&
    worldY <= viewport.worldY + viewport.worldH
  );
}

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

  // Scoped broadcast for drag and drop: reaches only clients whose reported
  // viewport contains the event point. Clients with no viewport yet are
  // included (see Client.viewport). Snap stays a global broadcast.
  broadcastNear(msg: ServerMessage, worldX: number, worldY: number, except?: Client): void {
    const payload = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c === except) continue;
      if (!viewportContains(c.viewport, worldX, worldY)) continue;
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
