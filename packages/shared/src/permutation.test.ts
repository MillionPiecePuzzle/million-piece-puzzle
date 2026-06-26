import { describe, it, expect } from "vitest";
import { buildPermutation } from "./permutation.js";

describe("buildPermutation", () => {
  it("is a bijection over [0, n)", () => {
    const n = 1000;
    const { wireForGrid, gridForWire } = buildPermutation("seed", n);
    expect(wireForGrid).toHaveLength(n);
    expect(gridForWire).toHaveLength(n);
    const seen = new Set<number>();
    for (let gridId = 0; gridId < n; gridId++) {
      const wireId = wireForGrid[gridId]!;
      expect(wireId).toBeGreaterThanOrEqual(0);
      expect(wireId).toBeLessThan(n);
      seen.add(wireId);
      // Inverse round-trips.
      expect(gridForWire[wireId]).toBe(gridId);
    }
    expect(seen.size).toBe(n);
  });

  it("is stable for a fixed seed", () => {
    const a = buildPermutation("alpha-3-2026", 4096);
    const b = buildPermutation("alpha-3-2026", 4096);
    expect([...a.wireForGrid]).toEqual([...b.wireForGrid]);
  });

  it("differs between seeds", () => {
    const a = buildPermutation("one", 4096);
    const b = buildPermutation("two", 4096);
    expect([...a.wireForGrid]).not.toEqual([...b.wireForGrid]);
  });

  it("actually permutes (not the identity)", () => {
    const n = 10000;
    const { wireForGrid } = buildPermutation("seed", n);
    let fixed = 0;
    for (let i = 0; i < n; i++) if (wireForGrid[i] === i) fixed++;
    // A random permutation of n elements has ~1 expected fixed point; assert the
    // ids are not shipped in solved order.
    expect(fixed).toBeLessThan(n / 100);
  });

  it("handles the degenerate sizes", () => {
    expect([...buildPermutation("s", 1).wireForGrid]).toEqual([0]);
    expect([...buildPermutation("s", 0).wireForGrid]).toEqual([]);
  });
});
