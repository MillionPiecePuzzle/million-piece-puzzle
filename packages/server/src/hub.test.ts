import { describe, it, expect } from "vitest";
import { Hub, type Client, type Viewport } from "./hub.js";
import { localAabbForPieces, worldAabbFor, type Aabb } from "./worldGrid.js";
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

const CELL = 100;
const MAX_CELLS = 256;

function newHub(maxCells = MAX_CELLS): Hub {
  return new Hub(1 << 20, CELL, maxCells);
}

function makeClient(viewport: Viewport | null): { client: Client; ws: FakeWs } {
  const ws = new FakeWs();
  const client = {
    userId: "u",
    ws,
    bucket: { consume: () => true },
    viewport,
    cells: new Set<number>(),
  } as unknown as Client;
  return { client, ws };
}

// Register a client and compute its cell subscription from its viewport, the way
// `add` followed by a `viewport` message does on a real connection.
function join(hub: Hub, viewport: Viewport | null): { client: Client; ws: FakeWs } {
  const { client, ws } = makeClient(viewport);
  hub.add(client);
  hub.updateSubscription(client);
  return { client, ws };
}

const drag: ServerMessage = { t: "drag", groupId: 1, worldX: 50, worldY: 50, userId: "u" };
// A zero-size rect at (x, y): how a cursor or a single point is scoped.
const point = (x: number, y: number): Aabb => ({ minX: x, minY: y, maxX: x, maxY: y });

describe("Hub.broadcastOverlapping", () => {
  it("sends to a client whose viewport overlaps the event cell", () => {
    const hub = newHub();
    const { ws } = join(hub, { worldX: 0, worldY: 0, worldW: 100, worldH: 100 });
    hub.broadcastOverlapping(drag, point(50, 50));
    expect(ws.sent).toHaveLength(1);
  });

  it("skips a client whose viewport does not overlap the event cell", () => {
    const hub = newHub();
    const { ws } = join(hub, { worldX: 1000, worldY: 1000, worldW: 100, worldH: 100 });
    hub.broadcastOverlapping(drag, point(50, 50));
    expect(ws.sent).toHaveLength(0);
  });

  it("includes a client that has not reported a viewport yet (fail-open)", () => {
    const hub = newHub();
    const { ws } = join(hub, null);
    hub.broadcastOverlapping(drag, point(50, 50));
    expect(ws.sent).toHaveLength(1);
  });

  it("treats a viewport larger than the cell cap as a global subscriber", () => {
    const hub = newHub(4);
    // Spans far more than 4 cells, so it falls into the global set and receives an
    // event anywhere on the canvas, not just inside its own rect.
    const { ws } = join(hub, { worldX: 0, worldY: 0, worldW: 10000, worldH: 10000 });
    hub.broadcastOverlapping(drag, point(50000, 50000));
    expect(ws.sent).toHaveLength(1);
  });

  it("fans a cluster larger than the cell cap out to every client", () => {
    const hub = newHub(4);
    const { ws } = join(hub, { worldX: 0, worldY: 0, worldW: 100, worldH: 100 });
    // A board-spanning cluster overlaps more than the cap, so it reaches everyone
    // even though this small viewport sits nowhere near most of it.
    hub.broadcastOverlapping(drag, { minX: 0, minY: 0, maxX: 100000, maxY: 100000 });
    expect(ws.sent).toHaveLength(1);
  });

  it("never sends to the excepted client even when subscribed", () => {
    const hub = newHub();
    const { client, ws } = join(hub, { worldX: 0, worldY: 0, worldW: 100, worldH: 100 });
    hub.broadcastOverlapping(drag, point(50, 50), client);
    expect(ws.sent).toHaveLength(0);
  });

  it("sends once to a client whose viewport overlaps several event cells", () => {
    const hub = newHub();
    // Both the viewport and the event AABB span cells (0,0)..(1,1); without dedup
    // the client would receive four copies.
    const { ws } = join(hub, { worldX: 0, worldY: 0, worldW: 100, worldH: 100 });
    hub.broadcastOverlapping(drag, { minX: 0, minY: 0, maxX: 150, maxY: 150 });
    expect(ws.sent).toHaveLength(1);
  });

  it("re-scopes a client when its viewport moves", () => {
    const hub = newHub();
    const { client, ws } = join(hub, { worldX: 0, worldY: 0, worldW: 100, worldH: 100 });
    client.viewport = { worldX: 1000, worldY: 1000, worldW: 100, worldH: 100 };
    hub.updateSubscription(client);
    hub.broadcastOverlapping(drag, point(50, 50));
    expect(ws.sent).toHaveLength(0);
    hub.broadcastOverlapping(drag, point(1050, 1050));
    expect(ws.sent).toHaveLength(1);
  });

  it("removes a client from every cell on disconnect", () => {
    const hub = newHub();
    const { client, ws } = join(hub, { worldX: 0, worldY: 0, worldW: 100, worldH: 100 });
    hub.remove(client);
    hub.broadcastOverlapping(drag, point(50, 50));
    expect(ws.sent).toHaveLength(0);
    expect(client.cells.size).toBe(0);
  });
});

// The fix the cluster-AABB scoping buys over the old origin-point scoping: a peer
// whose viewport misses the cluster origin but overlaps its body still hears it.
describe("Hub.broadcastOverlapping cluster body scoping", () => {
  it("reaches a peer whose viewport excludes the cluster origin but overlaps its body", () => {
    const hub = newHub();
    // Peer looks at cells around (500,500); the cluster origin (0,0) is off their
    // screen, but the cluster body reaches to (600,600).
    const { ws } = join(hub, { worldX: 500, worldY: 500, worldW: 100, worldH: 100 });
    hub.broadcastOverlapping(drag, { minX: 0, minY: 0, maxX: 600, maxY: 600 });
    expect(ws.sent).toHaveLength(1);
  });

  it("would miss that peer when only the origin point is scoped (the old behavior)", () => {
    const hub = newHub();
    const { ws } = join(hub, { worldX: 500, worldY: 500, worldW: 100, worldH: 100 });
    hub.broadcastOverlapping(drag, point(0, 0));
    expect(ws.sent).toHaveLength(0);
  });
});

describe("Hub.broadcast", () => {
  it("reaches a client regardless of its viewport, so snap stays global", () => {
    const hub = newHub();
    const { ws } = join(hub, { worldX: 1000, worldY: 1000, worldW: 100, worldH: 100 });
    hub.broadcast({ t: "snap" } as ServerMessage);
    expect(ws.sent).toHaveLength(1);
  });
});

describe("localAabbForPieces", () => {
  it("returns one piece footprint for a singleton", () => {
    // 3x3 grid, pieceSize 100: piece 4 is col 1, row 1.
    expect(localAabbForPieces([4], 3, 100)).toEqual({ minX: 100, minY: 100, maxX: 200, maxY: 200 });
  });

  it("unions the member cells for a cluster", () => {
    // pieces 0 (col0,row0), 1 (col1,row0), 3 (col0,row1): cols 0..1, rows 0..1.
    expect(localAabbForPieces([0, 1, 3], 3, 100)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 200,
      maxY: 200,
    });
  });
});

describe("worldAabbFor", () => {
  it("translates the local AABB by the origin", () => {
    expect(worldAabbFor({ minX: 100, minY: 100, maxX: 200, maxY: 200 }, 500, 500)).toEqual({
      minX: 600,
      minY: 600,
      maxX: 700,
      maxY: 700,
    });
  });

  it("falls back to a zero-size rect at the origin when the local AABB is null", () => {
    expect(worldAabbFor(null, 5, 7)).toEqual({ minX: 5, minY: 7, maxX: 5, maxY: 7 });
  });
});
