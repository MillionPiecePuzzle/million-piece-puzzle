import { describe, it, expect } from "vitest";
import { resolveSnap } from "./membership";

// The partial-board snap decision: which added pieces reassign to the host, which
// KNOWN source groups to remove, and whether the host is built on this client.
// knownGroups is any `has` predicate (the stage passes its groups Map); here a Set.
const known = (...ids: number[]): Set<number> => new Set(ids);
const p2g = (pairs: [number, number][]): Map<number, number> => new Map(pairs);

describe("resolveSnap", () => {
  it("host known, all sources known: reassigns the added pieces and removes the known sources", () => {
    // group 1 (piece 1) absorbs group 4 (piece 4); survivor id 1.
    const plan = resolveSnap(
      1,
      [4],
      known(1, 4),
      p2g([
        [1, 1],
        [4, 4],
      ]),
    );
    expect(plan.hostKnown).toBe(true);
    expect(plan.reassign).toEqual([4]);
    expect(plan.removeGroups).toEqual([4]);
  });

  it("skips an added piece already on the host", () => {
    const plan = resolveSnap(
      1,
      [1, 4],
      known(1, 4),
      p2g([
        [1, 1],
        [4, 4],
      ]),
    );
    expect(plan.reassign).toEqual([4]);
    expect(plan.removeGroups).toEqual([4]);
  });

  it("host known, source never visited: reassigns membership but removes nothing", () => {
    // piece 9's source group 9 was never built on this partial board, so there is
    // no node to remove, but membership still moves to the known host.
    const plan = resolveSnap(
      1,
      [9],
      known(1),
      p2g([
        [1, 1],
        [9, 9],
      ]),
    );
    expect(plan.hostKnown).toBe(true);
    expect(plan.reassign).toEqual([9]);
    expect(plan.removeGroups).toEqual([]);
  });

  it("host known, straddling the boundary: one source known, one not", () => {
    const plan = resolveSnap(
      1,
      [4, 9],
      known(1, 4),
      p2g([
        [1, 1],
        [4, 4],
        [9, 9],
      ]),
    );
    expect(plan.hostKnown).toBe(true);
    expect(plan.reassign).toEqual([4, 9]);
    // Only the known source is removed; the unknown one has nothing to phantom.
    expect(plan.removeGroups).toEqual([4]);
  });

  it("host unknown: still reassigns the added pieces and removes known sources, so no phantom survives", () => {
    // Survivor id 2 was never visited; source group 4 is known and must be removed.
    const plan = resolveSnap(2, [4], known(4), p2g([[4, 4]]));
    expect(plan.hostKnown).toBe(false);
    expect(plan.reassign).toEqual([4]);
    expect(plan.removeGroups).toEqual([4]);
  });

  it("dedups a source group spanning several added pieces", () => {
    const plan = resolveSnap(
      1,
      [4, 5],
      known(1, 4),
      p2g([
        [1, 1],
        [4, 4],
        [5, 4],
      ]),
    );
    expect(plan.reassign).toEqual([4, 5]);
    expect(plan.removeGroups).toEqual([4]);
  });
});
