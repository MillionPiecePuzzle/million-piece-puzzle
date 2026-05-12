import type { WebSocket } from "ws";
import type { ServerMessage } from "@mpp/shared";

export type Client = {
  userId: string;
  ws: WebSocket;
};

export class Hub {
  private readonly clients = new Set<Client>();

  add(client: Client): void {
    this.clients.add(client);
  }

  remove(client: Client): void {
    this.clients.delete(client);
  }

  send(client: Client, msg: ServerMessage): void {
    if (client.ws.readyState === client.ws.OPEN) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg: ServerMessage, except?: Client): void {
    const payload = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c === except) continue;
      if (c.ws.readyState === c.ws.OPEN) {
        c.ws.send(payload);
      }
    }
  }
}
