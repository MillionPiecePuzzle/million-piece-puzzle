import { describe, it, expect } from "vitest";
import {
  cellContentPending,
  classifyTile,
  coalesceDirtyCells,
  residencyDecision,
} from "./reconcile";
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

    it("a global subscriber (never coverageSeen) falls through to hydration", () => {
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

describe("classifyTile", () => {
  const facts = (over: Partial<Parameters<typeof classifyTile>[0]>) =>
    classifyTile({
      known: false,
      hasGroups: false,
      lodActive: false,
      tileReady: false,
      allHydrated: false,
      activelyLoading: false,
      ...over,
    });

  it("is not-loaded outside knownCells regardless of any other fact", () => {
    expect(facts({ known: false })).toBe("not-loaded");
    expect(
      facts({
        known: false,
        hasGroups: true,
        allHydrated: true,
        tileReady: true,
        activelyLoading: true,
      }),
    ).toBe("not-loaded");
  });

  it("is loaded for a known, empty cell", () => {
    expect(facts({ known: true, hasGroups: false })).toBe("loaded");
  });

  describe("zoom-out (LOD active)", () => {
    it("is loading while the cell's tile has not baked and is in the active bake set", () => {
      expect(
        facts({
          known: true,
          hasGroups: true,
          lodActive: true,
          tileReady: false,
          activelyLoading: true,
        }),
      ).toBe("loading");
    });

    it("is not-loaded while the tile has not baked but nothing is baking it right now", () => {
      expect(
        facts({
          known: true,
          hasGroups: true,
          lodActive: true,
          tileReady: false,
          activelyLoading: false,
        }),
      ).toBe("not-loaded");
    });

    it("is loaded once the tile is baked", () => {
      expect(facts({ known: true, hasGroups: true, lodActive: true, tileReady: true })).toBe(
        "loaded",
      );
    });

    it("ignores hydration while active", () => {
      expect(
        facts({
          known: true,
          hasGroups: true,
          lodActive: true,
          tileReady: true,
          allHydrated: false,
        }),
      ).toBe("loaded");
    });
  });

  describe("zoom-in (LOD inactive)", () => {
    it("is loading while some group in the cell is unhydrated and actively fetching", () => {
      expect(
        facts({
          known: true,
          hasGroups: true,
          lodActive: false,
          allHydrated: false,
          activelyLoading: true,
        }),
      ).toBe("loading");
    });

    it("is not-loaded while some group is unhydrated but idle (evicted, not queued)", () => {
      expect(
        facts({
          known: true,
          hasGroups: true,
          lodActive: false,
          allHydrated: false,
          activelyLoading: false,
        }),
      ).toBe("not-loaded");
    });

    it("is loaded once every group in the cell is hydrated", () => {
      expect(facts({ known: true, hasGroups: true, lodActive: false, allHydrated: true })).toBe(
        "loaded",
      );
    });
  });
});
