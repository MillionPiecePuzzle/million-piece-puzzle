import { describe, it, expect } from "vitest";
import { Hub, type Client, type Viewport } from "./hub.js";
import type { ServerMessage } from "@mpp/shared";

class FakeWs {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  send(payload: string): void {
    this.sent.push(payload);
  }
  close(): void {
    this.readyState = 3;
  }
}

function makeClient(viewport: Viewport | null): { client: Client; ws: FakeWs } {
  const ws = new FakeWs();
  const client = {
    userId: "u",
    ws,
    bucket: { consume: () => true },
    viewport,
  } as unknown as Client;
  return { client, ws };
}

const inside: Viewport = { worldX: 0, worldY: 0, worldW: 100, worldH: 100 };
const elsewhere: Viewport = { worldX: 1000, worldY: 1000, worldW: 100, worldH: 100 };
const drag: ServerMessage = { t: "drag", groupId: 1, worldX: 50, worldY: 50, userId: "u" };

describe("Hub.broadcastNear", () => {
  it("sends to a client whose viewport contains the event point", () => {
    const hub = new Hub(1 << 20);
    const { client, ws } = makeClient(inside);
    hub.add(client);
    hub.broadcastNear(drag, 50, 50);
    expect(ws.sent).toHaveLength(1);
  });

  it("skips a client whose viewport does not contain the event point", () => {
    const hub = new Hub(1 << 20);
    const { client, ws } = makeClient(elsewhere);
    hub.add(client);
    hub.broadcastNear(drag, 50, 50);
    expect(ws.sent).toHaveLength(0);
  });

  it("includes a client that has not reported a viewport yet", () => {
    const hub = new Hub(1 << 20);
    const { client, ws } = makeClient(null);
    hub.add(client);
    hub.broadcastNear(drag, 50, 50);
    expect(ws.sent).toHaveLength(1);
  });

  it("treats the viewport bounds as inclusive", () => {
    const hub = new Hub(1 << 20);
    const { client, ws } = makeClient(inside);
    hub.add(client);
    hub.broadcastNear(drag, 100, 100);
    expect(ws.sent).toHaveLength(1);
  });

  it("never sends to the excepted client even when its viewport matches", () => {
    const hub = new Hub(1 << 20);
    const { client, ws } = makeClient(inside);
    hub.add(client);
    hub.broadcastNear(drag, 50, 50, client);
    expect(ws.sent).toHaveLength(0);
  });
});

describe("Hub.broadcast", () => {
  it("reaches a client regardless of its viewport, so snap stays global", () => {
    const hub = new Hub(1 << 20);
    const { client, ws } = makeClient(elsewhere);
    hub.add(client);
    hub.broadcast({ t: "snap" } as ServerMessage);
    expect(ws.sent).toHaveLength(1);
  });
});
