import { describe, it, expect } from "vitest";
import { cellContentPending, coalesceDirtyCells, residencyDecision } from "./reconcile";
import { packCell } from "./groupGrid";
import type { Aabb } from "./cull";

const box = (minX: number, minY: number, maxX: number, maxY: number): Aabb => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe("coalesceDirtyCells", () => {
  it("returns an empty set for no rects", () => {
    expect(coalesceDirtyCells([], 100)).toEqual(new Set());
  });

  it("maps a rect inside one cell to that cell", () => {
    expect(coalesceDirtyCells([box(10, 10, 90, 90)], 100)).toEqual(new Set([packCell(0, 0)]));
  });

  it("coalesces several same-cell rects into a single cell (one re-bake, not one per event)", () => {
    const cells = coalesceDirtyCells([box(10, 10, 20, 20), box(50, 50, 60, 60)], 100);
    expect(cells).toEqual(new Set([packCell(0, 0)]));
    expect(cells.size).toBe(1);
  });

  it("includes every cell a rect straddles", () => {
    expect(coalesceDirtyCells([box(90, 10, 110, 20)], 100)).toEqual(
      new Set([packCell(0, 0), packCell(1, 0)]),
    );
  });

  it("unions the cells of disjoint rects", () => {
    expect(coalesceDirtyCells([box(10, 10, 20, 20), box(210, 210, 220, 220)], 100)).toEqual(
      new Set([packCell(0, 0), packCell(2, 2)]),
    );
  });
});

describe("residencyDecision", () => {
  it("leaves a group outside the hydrate ring alone", () => {
    expect(residencyDecision(false, false)).toBe("none");
    expect(residencyDecision(false, true)).toBe("none");
  });

  it("hydrates an in-ring group that is not covered-cold", () => {
    expect(residencyDecision(true, false)).toBe("hydrate");
  });

  it("retains an in-ring covered-cold group for budget eviction", () => {
    expect(residencyDecision(true, true)).toBe("retain");
  });
});

describe("cellContentPending", () => {
  const facts = (over: Partial<Parameters<typeof cellContentPending>[0]>) =>
    cellContentPending({
      lodActive: false,
      hasGroups: false,
      tileReady: false,
      coverageSeen: false,
      known: false,
      hasUnhydratedInRingGroup: false,
      ...over,
    });

  describe("zoom-out (LOD active)", () => {
    it("pends a cell with groups whose tile has not baked", () => {
      expect(facts({ lodActive: true, hasGroups: true, tileReady: false })).toBe(true);
    });

    it("does not pend once the tile is baked", () => {
      expect(facts({ lodActive: true, hasGroups: true, tileReady: true })).toBe(false);
    });

    it("does not pend an empty cell (bakes blank instantly)", () => {
      expect(facts({ lodActive: true, hasGroups: false, tileReady: false })).toBe(false);
    });

    it("ignores the streaming and hydration facts while active", () => {
      expect(
        facts({
          lodActive: true,
          hasGroups: false,
          coverageSeen: true,
          known: false,
          hasUnhydratedInRingGroup: true,
        }),
      ).toBe(false);
    });
  });

  describe("zoom-in, region not streamed in", () => {
    it("pends a not-yet-known cell once the board streams in", () => {
      expect(facts({ coverageSeen: true, known: false })).toBe(true);
    });

    it("does not pend a known cell on the streaming ground alone", () => {
      expect(facts({ coverageSeen: true, known: true })).toBe(false);
    });

    it("a full-board spectator (never coverageSeen) falls through to hydration", () => {
      expect(facts({ coverageSeen: false, known: false, hasUnhydratedInRingGroup: true })).toBe(
        true,
      );
      expect(facts({ coverageSeen: false, known: false, hasUnhydratedInRingGroup: false })).toBe(
        false,
      );
    });
  });

  describe("zoom-in, streaming textures", () => {
    it("pends a known cell with an in-ring group still hydrating", () => {
      expect(facts({ coverageSeen: true, known: true, hasUnhydratedInRingGroup: true })).toBe(true);
    });

    it("does not pend a known cell whose groups are all hydrated", () => {
      expect(facts({ coverageSeen: true, known: true, hasUnhydratedInRingGroup: false })).toBe(
        false,
      );
    });
  });
});
