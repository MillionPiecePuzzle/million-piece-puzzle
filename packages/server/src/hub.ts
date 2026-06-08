import type { WebSocket } from "ws";
import type { ServerMessage } from "@mpp/shared";
import type { TokenBucket } from "./limits.js";
import { type Aabb, cellsForRect } from "./worldGrid.js";

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
  // Group ids this connection currently holds: added on a winning grab, removed
  // on the drop that ends the hold. Lets disconnect cleanup release in O(held)
  // instead of scanning the whole board. Entries can be stale (a held group
  // merged away before disconnect), so the release re-checks ownership under the
  // group's queue.
  held: Set<number>;
  // Broadcast-grid cells this client's viewport currently overlaps. Empty means
  // the client is a global subscriber (no viewport yet, or a viewport larger than
  // the cell cap), which receives every scoped broadcast (fail-open). Maintained
  // by the Hub; the invariant `cells.size === 0` iff global subscriber holds.
  cells: Set<number>;
  // Heartbeat liveness: set true on every pong, cleared when a ping is sent. A
  // client still false at the next heartbeat tick missed its pong and is dropped.
  alive: boolean;
};

// WebSocket close code 1013 ("Try Again Later") for slow consumers whose
// outbound buffer has grown past the configured limit.
const CLOSE_TRY_AGAIN_LATER = 1013;

function viewportAabb(v: Viewport): Aabb {
  return { minX: v.worldX, minY: v.worldY, maxX: v.worldX + v.worldW, maxY: v.worldY + v.worldH };
}

export class Hub {
  private readonly clients = new Set<Client>();
  // Spatial broadcast index: a cell key maps to the clients whose viewport
  // overlaps that cell, plus a global set for clients with no bounded viewport. A
  // client sits in exactly one side (cells non-empty XOR globalSubscribers), so a
  // scoped broadcast walks only the cells an event touches instead of every
  // connected client.
  private readonly cellSubscribers = new Map<number, Set<Client>>();
  private readonly globalSubscribers = new Set<Client>();

  constructor(
    private readonly bufferedAmountLimitBytes: number,
    private readonly cellSize: number,
    private readonly maxCells: number,
  ) {}

  add(client: Client): void {
    this.clients.add(client);
    // No viewport reported yet, so the client is a global subscriber (fail-open)
    // until its first `viewport` message moves it into cells.
    this.globalSubscribers.add(client);
  }

  remove(client: Client): void {
    this.clients.delete(client);
    this.globalSubscribers.delete(client);
    for (const cell of client.cells) this.removeFromCell(cell, client);
    client.cells.clear();
  }

  // Recompute a client's cell subscription from its current viewport, diffing
  // against its existing cells so the update is O(cells), not O(clients). A null
  // viewport, or one overlapping more than maxCells cells, makes the client a
  // global subscriber. Returns the cells newly added to the client's
  // subscription, so the caller can resync region state for exactly those (a
  // client moving from global to scoped enters all of its viewport cells; one
  // panning enters only the leading band). Empty when nothing new is entered or
  // the client becomes a global subscriber.
  updateSubscription(client: Client): number[] {
    const cells =
      client.viewport === null
        ? null
        : cellsForRect(viewportAabb(client.viewport), this.cellSize, this.maxCells);
    if (cells === null) {
      for (const cell of client.cells) this.removeFromCell(cell, client);
      client.cells.clear();
      this.globalSubscribers.add(client);
      return [];
    }
    this.globalSubscribers.delete(client);
    const next = new Set(cells);
    for (const cell of client.cells) {
      if (!next.has(cell)) this.removeFromCell(cell, client);
    }
    const entered: number[] = [];
    for (const cell of next) {
      if (!client.cells.has(cell)) {
        this.addToCell(cell, client);
        entered.push(cell);
      }
    }
    client.cells = next;
    return entered;
  }

  // Drop a client back to the global-subscriber state it joined in: clear its
  // cells so its next `viewport` re-enters all of them and re-streams region_state.
  // Used on a server-driven rebuild (welcome resent on reset/force-complete),
  // where the connection persists but the client has discarded its board, so an
  // unchanged viewport would otherwise enter no new cells and the board would
  // never re-stream. A no-op for a fresh connection (cells already empty).
  resetSubscription(client: Client): void {
    for (const cell of client.cells) this.removeFromCell(cell, client);
    client.cells.clear();
    this.globalSubscribers.add(client);
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

  // Scoped broadcast for drag, drop and cursor: reaches the global subscribers
  // plus the clients subscribed to any cell the event AABB overlaps. Scoping is by
  // the dragged cluster's world AABB (a cursor passes a zero-size rect), so a peer
  // whose viewport excludes the cluster origin but overlaps its body still
  // receives it. A cluster larger than the cell cap fans out to every client (the
  // same fail-open bound a far-zoomed viewport gets). Snap stays a global
  // broadcast.
  broadcastOverlapping(msg: ServerMessage, aabb: Aabb, except?: Client): void {
    const cells = cellsForRect(aabb, this.cellSize, this.maxCells);
    if (cells === null) {
      this.broadcast(msg, except);
      return;
    }
    const payload = JSON.stringify(msg);
    const seen = new Set<Client>();
    for (const c of this.globalSubscribers) {
      if (c === except) continue;
      seen.add(c);
      this.write(c, payload);
    }
    for (const cell of cells) {
      const set = this.cellSubscribers.get(cell);
      if (!set) continue;
      for (const c of set) {
        if (c === except || seen.has(c)) continue;
        seen.add(c);
        this.write(c, payload);
      }
    }
  }

  private addToCell(cell: number, client: Client): void {
    let set = this.cellSubscribers.get(cell);
    if (!set) {
      set = new Set();
      this.cellSubscribers.set(cell, set);
    }
    set.add(client);
  }

  private removeFromCell(cell: number, client: Client): void {
    const set = this.cellSubscribers.get(cell);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.cellSubscribers.delete(cell);
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
