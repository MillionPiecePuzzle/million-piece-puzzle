import { describe, it, expect } from "vitest";
import { AdmissionController, type AdmissionOptions } from "./admission.js";

function make(overrides: Partial<AdmissionOptions> = {}) {
  let clock = 1000;
  let n = 0;
  const ctrl = new AdmissionController({
    cap: 2,
    grantTtlMs: 10_000,
    ticketTtlMs: 15_000,
    maxQueueLength: 100,
    now: () => clock,
    genId: () => `id${n++}`,
    ...overrides,
  });
  return {
    ctrl,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("AdmissionController", () => {
  it("is disabled when the cap is zero", () => {
    const { ctrl } = make({ cap: 0 });
    expect(ctrl.enabled).toBe(false);
    expect(ctrl.requestTicket()).toEqual({ state: "disabled" });
    expect(ctrl.status("whatever")).toEqual({ state: "disabled" });
  });

  it("grants immediately under the cap and redeems into a connection", () => {
    const { ctrl } = make();
    const r1 = ctrl.requestTicket();
    expect(r1.state).toBe("ready");
    if (r1.state !== "ready") return;
    expect(ctrl.occupancy()).toBe(1);
    expect(ctrl.redeem(r1.grant)).toBe(true);
    expect(ctrl.activeConnections()).toBe(1);
    expect(ctrl.occupancy()).toBe(1);
  });

  it("queues past the cap and admits when a connection closes", () => {
    const { ctrl } = make();
    const a = ctrl.requestTicket();
    const b = ctrl.requestTicket();
    if (a.state !== "ready" || b.state !== "ready") throw new Error("expected ready");
    ctrl.redeem(a.grant);
    ctrl.redeem(b.grant);
    expect(ctrl.occupancy()).toBe(2);

    const c = ctrl.requestTicket();
    expect(c.state).toBe("queued");
    if (c.state !== "queued") return;
    expect(c.position).toBe(1);
    expect(ctrl.status(c.ticket)).toMatchObject({ state: "queued", position: 1 });

    ctrl.releaseConnection();
    const after = ctrl.status(c.ticket);
    expect(after.state).toBe("ready");
    if (after.state !== "ready") return;
    expect(ctrl.redeem(after.grant)).toBe(true);
  });

  it("reports FIFO positions and shrinks them as the line advances", () => {
    const { ctrl } = make({ cap: 1 });
    const first = ctrl.requestTicket();
    if (first.state !== "ready") throw new Error("expected ready");
    ctrl.redeem(first.grant);

    const q1 = ctrl.requestTicket();
    const q2 = ctrl.requestTicket();
    if (q1.state !== "queued" || q2.state !== "queued") throw new Error("expected queued");
    expect(q1.position).toBe(1);
    expect(q2.position).toBe(2);

    ctrl.releaseConnection();
    expect(ctrl.status(q1.ticket).state).toBe("ready");
    expect(ctrl.status(q2.ticket)).toMatchObject({ state: "queued", position: 1 });
  });

  it("reclaims an unredeemed grant after its TTL and admits the next waiter", () => {
    const { ctrl, advance } = make({ cap: 1 });
    const a = ctrl.requestTicket();
    if (a.state !== "ready") throw new Error("expected ready");
    const b = ctrl.requestTicket();
    if (b.state !== "queued") throw new Error("expected queued");
    expect(ctrl.occupancy()).toBe(1);

    advance(10_001);
    ctrl.sweep();
    expect(ctrl.status(b.ticket).state).toBe("ready");
    // a's grant is gone, so it can no longer be redeemed.
    expect(ctrl.redeem(a.grant)).toBe(false);
  });

  it("expires a stale grant on poll without waiting for the sweep", () => {
    const { ctrl, advance } = make({ cap: 1 });
    const a = ctrl.requestTicket();
    if (a.state !== "ready") throw new Error("expected ready");
    advance(10_001);
    expect(ctrl.status(a.ticket)).toEqual({ state: "expired" });
    expect(ctrl.peekGrant(a.grant)).toBe(false);
  });

  it("reaps an abandoned waiter that stops polling", () => {
    const { ctrl, advance } = make({ cap: 1 });
    const a = ctrl.requestTicket();
    if (a.state !== "ready") throw new Error("expected ready");
    ctrl.redeem(a.grant);
    const b = ctrl.requestTicket();
    if (b.state !== "queued") throw new Error("expected queued");

    advance(15_001);
    ctrl.sweep();
    expect(ctrl.status(b.ticket)).toEqual({ state: "expired" });
  });

  it("makes a grant single-use", () => {
    const { ctrl } = make();
    const a = ctrl.requestTicket();
    if (a.state !== "ready") throw new Error("expected ready");
    expect(ctrl.peekGrant(a.grant)).toBe(true);
    expect(ctrl.redeem(a.grant)).toBe(true);
    expect(ctrl.redeem(a.grant)).toBe(false);
    expect(ctrl.peekGrant(a.grant)).toBe(false);
  });

  it("rejects nullish and unknown grants", () => {
    const { ctrl } = make();
    expect(ctrl.peekGrant(null)).toBe(false);
    expect(ctrl.peekGrant(undefined)).toBe(false);
    expect(ctrl.peekGrant("")).toBe(false);
    expect(ctrl.redeem("nope")).toBe(false);
  });

  it("turns away a request when the wait list is full", () => {
    const { ctrl } = make({ cap: 1, maxQueueLength: 1 });
    const a = ctrl.requestTicket();
    if (a.state !== "ready") throw new Error("expected ready");
    expect(ctrl.requestTicket().state).toBe("queued");
    expect(ctrl.requestTicket()).toEqual({ state: "busy" });
  });

  it("never lets connections exceed the cap", () => {
    const { ctrl } = make({ cap: 3 });
    const grants: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = ctrl.requestTicket();
      if (r.state === "ready") grants.push(r.grant);
    }
    for (const g of grants) ctrl.redeem(g);
    expect(ctrl.activeConnections()).toBeLessThanOrEqual(3);
    expect(ctrl.occupancy()).toBeLessThanOrEqual(3);
  });
});
