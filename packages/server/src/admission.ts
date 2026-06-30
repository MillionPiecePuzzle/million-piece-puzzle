// Admission queue: a global cap on concurrent WS connections with a FIFO wait
// list in front of it (see DECISIONS: admission queue). A client requests a
// ticket; under the cap it is granted a one-time token immediately and connects
// with `?grant=`; over the cap it waits and polls status until a slot frees.
//
// In-process, single-writer state, like the Hub and the per-IP IpRegistry: one
// Node process owns every WS connection, so the cap, the wait list and the grant
// set live in this object with no Redis round-trip. It moves to shared state only
// when the writer is sharded (the same boundary the IpRegistry has).
//
// Occupancy = live connections + outstanding (issued, unredeemed) grants. An
// issued grant reserves a slot so the cap is never oversubscribed between the
// grant and the upgrade; the slot is returned when the grant is redeemed (becomes
// a connection), expires unredeemed, or the connection closes.

import type { QueueStatusResponse, QueueTicketResponse } from "@mpp/shared";

type Ticket = {
  id: string;
  // Creation order, monotonic. Drives the FIFO promotion order and the O(1)
  // position estimate (seq minus the highest seq admitted so far).
  seq: number;
  // Updated on every status poll. A queued ticket not polled within ticketTtlMs
  // is reaped, dropping an abandoned waiter (closed tab) out of the line.
  lastSeenAt: number;
  // null while queued; the one-time grant token once promoted. The slot it holds
  // is returned if the client does not redeem it before grantExpiresAt.
  grant: string | null;
  grantExpiresAt: number;
};

export type AdmissionOptions = {
  // 0 (or less) disables the queue entirely: tickets resolve to `disabled` and
  // the WS upgrade requires no grant, so the cap is opt-in per deployment.
  cap: number;
  // How long an issued, unredeemed grant holds its slot before it is reclaimed.
  grantTtlMs: number;
  // How long a queued ticket survives without a status poll before it is reaped.
  ticketTtlMs: number;
  // Upper bound on the wait list. A ticket request past it gets `busy` rather than
  // growing the list without limit (the box has finite memory under a flood).
  maxQueueLength: number;
  now?: () => number;
  genId?: () => string;
};

export class AdmissionController {
  private readonly cap: number;
  private readonly grantTtlMs: number;
  private readonly ticketTtlMs: number;
  private readonly maxQueueLength: number;
  private readonly now: () => number;
  private readonly genId: () => string;

  private readonly tickets = new Map<string, Ticket>();
  private readonly grantIndex = new Map<string, string>();
  // FIFO of queued ticket ids in seq order. May hold ids that have since been
  // promoted or reaped; those are skipped lazily at the head and dropped when the
  // wait list is rebuilt during a sweep, so the array stays bounded.
  private queue: string[] = [];
  private head = 0;

  private connections = 0;
  private grantedCount = 0;
  private queuedCount = 0;
  private createdSeq = 0;
  // Highest ticket seq promoted so far. Since promotion is FIFO (lowest seq
  // first), a still-queued ticket's distance past it estimates its position.
  private admittedThrough = 0;

  constructor(opts: AdmissionOptions) {
    this.cap = opts.cap;
    this.grantTtlMs = opts.grantTtlMs;
    this.ticketTtlMs = opts.ticketTtlMs;
    this.maxQueueLength = opts.maxQueueLength;
    this.now = opts.now ?? Date.now;
    this.genId = opts.genId ?? defaultGenId;
  }

  get enabled(): boolean {
    return this.cap > 0;
  }

  // Mint a wait-list ticket. Existing waiters are promoted into any free slots
  // first, so a fresh arrival never jumps the line: it is granted immediately only
  // when the line is empty and a slot is free, otherwise it queues at the back (or
  // is turned away with `busy` when the list is full).
  requestTicket(): QueueTicketResponse {
    if (!this.enabled) return { state: "disabled" };
    this.promote();
    if (this.occupancy() < this.cap) {
      const t = this.newTicket();
      this.grant(t);
      return { state: "ready", ticket: t.id, grant: t.grant as string };
    }
    if (this.queuedCount >= this.maxQueueLength) return { state: "busy" };
    const t = this.newTicket();
    this.queuedCount += 1;
    this.queue.push(t.id);
    return { state: "queued", ticket: t.id, position: this.positionOf(t) };
  }

  // Poll a ticket's state. Touches its last-seen so a waiting client stays in
  // line. A held grant that has expired unredeemed is reclaimed here and the
  // ticket reported `expired`, so a slow client re-requests rather than connecting
  // with a stale grant the upgrade would reject anyway.
  status(ticketId: string): QueueStatusResponse {
    if (!this.enabled) return { state: "disabled" };
    this.promote();
    const t = this.tickets.get(ticketId);
    if (!t) return { state: "expired" };
    t.lastSeenAt = this.now();
    if (t.grant !== null) {
      if (this.grantExpired(t)) {
        this.dropGranted(t);
        this.promote();
        return { state: "expired" };
      }
      return { state: "ready", ticket: t.id, grant: t.grant };
    }
    return { state: "queued", ticket: t.id, position: this.positionOf(t) };
  }

  // Non-consuming validity check, used by the WS upgrade to reject a bad grant
  // before the (async) session lookup. The single-use consumption is redeem().
  peekGrant(grant: string | null | undefined): boolean {
    const t = this.ticketForGrant(grant);
    return t !== null && !this.grantExpired(t);
  }

  // Atomically consume a grant for a connection: removes the ticket and turns its
  // reserved slot into a live connection (occupancy unchanged). Returns false for
  // an unknown, mismatched or expired grant, or a grant already redeemed by an
  // earlier upgrade, so the same token never admits two sockets.
  redeem(grant: string | null | undefined): boolean {
    const t = this.ticketForGrant(grant);
    if (!t) return false;
    if (this.grantExpired(t)) {
      this.dropGranted(t);
      this.promote();
      return false;
    }
    this.dropGranted(t);
    this.connections += 1;
    return true;
  }

  // Release a live connection's slot on close and admit the next waiter into it.
  releaseConnection(): void {
    if (this.connections > 0) this.connections -= 1;
    this.promote();
  }

  // Reclaim expired grants and abandoned waiters, then admit into the freed slots.
  // Called on a timer so a stalled grant or a closed tab frees its slot even when
  // no one polls. Rebuilds the wait list from the surviving queued tickets to drop
  // the consumed/stale prefix the lazy head leaves behind.
  sweep(): void {
    const now = this.now();
    for (const [id, t] of this.tickets) {
      if (t.grant !== null) {
        if (t.grantExpiresAt < now) this.dropGranted(t);
      } else if (t.lastSeenAt + this.ticketTtlMs < now) {
        this.tickets.delete(id);
        this.queuedCount -= 1;
      }
    }
    const rebuilt: string[] = [];
    for (const [id, t] of this.tickets) if (t.grant === null) rebuilt.push(id);
    this.queue = rebuilt;
    this.head = 0;
    this.promote();
  }

  occupancy(): number {
    return this.connections + this.grantedCount;
  }

  activeConnections(): number {
    return this.connections;
  }

  // Fill every free slot from the head of the wait list, lowest seq first.
  private promote(): void {
    while (this.occupancy() < this.cap) {
      const next = this.dequeueNext();
      if (next === null) return;
      this.queuedCount -= 1;
      this.grant(next);
    }
  }

  // Pop the next still-queued ticket from the FIFO, skipping ids that were already
  // promoted or reaped. Amortized O(1): each id is visited once across all calls.
  private dequeueNext(): Ticket | null {
    while (this.head < this.queue.length) {
      const id = this.queue[this.head];
      this.head += 1;
      if (id === undefined) continue;
      const t = this.tickets.get(id);
      if (t && t.grant === null) return t;
    }
    return null;
  }

  private grant(t: Ticket): void {
    const token = this.genId();
    t.grant = token;
    t.grantExpiresAt = this.now() + this.grantTtlMs;
    this.grantIndex.set(token, t.id);
    this.grantedCount += 1;
    if (t.seq > this.admittedThrough) this.admittedThrough = t.seq;
  }

  // Remove a granted ticket and return its slot (used both when a grant is
  // redeemed and when it expires unredeemed).
  private dropGranted(t: Ticket): void {
    if (t.grant !== null) this.grantIndex.delete(t.grant);
    this.tickets.delete(t.id);
    this.grantedCount -= 1;
  }

  private grantExpired(t: Ticket): boolean {
    return t.grant !== null && t.grantExpiresAt < this.now();
  }

  private ticketForGrant(grant: string | null | undefined): Ticket | null {
    if (!grant) return null;
    const id = this.grantIndex.get(grant);
    if (id === undefined) return null;
    const t = this.tickets.get(id);
    if (!t || t.grant !== grant) return null;
    return t;
  }

  private newTicket(): Ticket {
    this.createdSeq += 1;
    const t: Ticket = {
      id: this.genId(),
      seq: this.createdSeq,
      lastSeenAt: this.now(),
      grant: null,
      grantExpiresAt: 0,
    };
    this.tickets.set(t.id, t);
    return t;
  }

  // 1-based estimate: how far this ticket sits past the last one admitted. Counts
  // any reaped-but-not-yet-promoted gaps ahead, so it can read slightly high, never
  // low, and never gates admission.
  private positionOf(t: Ticket): number {
    return Math.max(1, t.seq - this.admittedThrough);
  }
}

function defaultGenId(): string {
  // Lazy import keeps the module loadable in a non-node test shim if needed.
  return cryptoRandomId();
}

function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID();
}
