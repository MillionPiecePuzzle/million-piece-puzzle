import { describe, it, expect } from "vitest";
import { resolveSnap, resolveAnchor } from "./membership";

// The partial-board snap decision: which added pieces reassign to the host and
// which KNOWN source groups to remove. knownGroups is any `has` predicate (the
// stage passes its groups Map); here a Set.
const known = (...ids: number[]): Set<number> => new Set(ids);
const p2g = (pairs: [number, number][]): Map<number, number> => new Map(pairs);
// resolveSnap takes wire pieces; it reads only the id, so the offsets are omitted.
const wp = (...ids: number[]): { id: number }[] => ids.map((id) => ({ id }));

describe("resolveSnap", () => {
  it("host known, all sources known: reassigns the added pieces and removes the known sources", () => {
    // group 1 (piece 1) absorbs group 4 (piece 4); survivor id 1.
    const plan = resolveSnap(
      1,
      wp(4),
      known(1, 4),
      p2g([
        [1, 1],
        [4, 4],
      ]),
    );
    expect(plan.removeGroups).toEqual([4]);
  });

  it("skips an added piece already on the host", () => {
    const plan = resolveSnap(
      1,
      wp(1, 4),
      known(1, 4),
      p2g([
        [1, 1],
        [4, 4],
      ]),
    );
    expect(plan.removeGroups).toEqual([4]);
  });

  it("host known, source never visited: reassigns membership but removes nothing", () => {
    // piece 9's source group 9 was never built on this partial board, so there is
    // no node to remove, but membership still moves to the known host.
    const plan = resolveSnap(
      1,
      wp(9),
      known(1),
      p2g([
        [1, 1],
        [9, 9],
      ]),
    );
    expect(plan.removeGroups).toEqual([]);
  });

  it("host known, straddling the boundary: one source known, one not", () => {
    const plan = resolveSnap(
      1,
      wp(4, 9),
      known(1, 4),
      p2g([
        [1, 1],
        [4, 4],
        [9, 9],
      ]),
    );
    // Only the known source is removed; the unknown one has nothing to phantom.
    expect(plan.removeGroups).toEqual([4]);
  });

  it("host unknown: still reassigns the added pieces and removes known sources, so no phantom survives", () => {
    // Survivor id 2 was never visited; source group 4 is known and must be removed.
    const plan = resolveSnap(2, wp(4), known(4), p2g([[4, 4]]));
    expect(plan.removeGroups).toEqual([4]);
  });

  it("dedups a source group spanning several added pieces", () => {
    const plan = resolveSnap(
      1,
      wp(4, 5),
      known(1, 4),
      p2g([
        [1, 1],
        [4, 4],
        [5, 4],
      ]),
    );
    expect(plan.removeGroups).toEqual([4]);
  });
});

// resolveAnchor reads id, dx, dy (a flat WirePiece), unlike resolveSnap's addedPieces.
const lp = (
  ...entries: [id: number, dx: number, dy: number][]
): { id: number; dx: number; dy: number }[] => entries.map(([id, dx, dy]) => ({ id, dx, dy }));

describe("resolveAnchor", () => {
  it("groups locked pieces by their current known owner", () => {
    const plan = resolveAnchor(
      lp([4, 1, 1], [5, 2, 1]),
      p2g([
        [4, 1],
        [5, 1],
      ]),
    );
    expect(plan.ungrouped).toEqual([]);
    expect([...plan.byGroup.keys()]).toEqual([1]);
    expect(plan.byGroup.get(1)).toEqual(lp([4, 1, 1], [5, 2, 1]));
  });

  it("splits pieces with different owners into separate group entries", () => {
    const plan = resolveAnchor(
      lp([4, 1, 1], [7, 3, 0]),
      p2g([
        [4, 1],
        [7, 2],
      ]),
    );
    expect(plan.byGroup.get(1)).toEqual(lp([4, 1, 1]));
    expect(plan.byGroup.get(2)).toEqual(lp([7, 3, 0]));
  });

  it("puts a piece with no known owner in ungrouped, not a phantom group entry", () => {
    const plan = resolveAnchor(lp([9, 0, 0]), p2g([]));
    expect(plan.byGroup.size).toBe(0);
    expect(plan.ungrouped).toEqual(lp([9, 0, 0]));
  });

  it("splits a mix of owned and unowned pieces correctly", () => {
    const plan = resolveAnchor(lp([4, 1, 1], [9, 0, 0]), p2g([[4, 1]]));
    expect(plan.byGroup.get(1)).toEqual(lp([4, 1, 1]));
    expect(plan.ungrouped).toEqual(lp([9, 0, 0]));
  });
});
