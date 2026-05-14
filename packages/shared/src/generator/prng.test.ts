import { describe, it, expect } from "vitest";
import { xmur3, mulberry32, seedFromString, subseed } from "./prng.js";

describe("xmur3", () => {
  it("is deterministic for the same string", () => {
    expect(xmur3("hello")()).toBe(xmur3("hello")());
  });

  it("produces different seeds for different strings", () => {
    expect(xmur3("hello")()).not.toBe(xmur3("world")());
  });

  it("returns unsigned 32-bit integers", () => {
    const next = xmur3("million-piece-puzzle");
    for (let i = 0; i < 100; i++) {
      const v = next();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("mulberry32", () => {
  it("produces the same stream for the same seed", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("produces different streams for different seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("returns doubles in [0, 1)", () => {
    const rng = mulberry32(98765);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("seedFromString", () => {
  it("is deterministic", () => {
    expect(seedFromString("seed")).toBe(seedFromString("seed"));
  });

  it("equals the first xmur3 output", () => {
    expect(seedFromString("seed")).toBe(xmur3("seed")());
  });
});

describe("subseed", () => {
  it("is deterministic for the same base and keys", () => {
    expect(subseed(42, 0, 1, 2)).toBe(subseed(42, 0, 1, 2));
  });

  it("depends on key order", () => {
    expect(subseed(42, 1, 2)).not.toBe(subseed(42, 2, 1));
  });

  it("depends on the base", () => {
    expect(subseed(1, 5)).not.toBe(subseed(2, 5));
  });

  it("returns an unsigned 32-bit integer", () => {
    const v = subseed(0xdeadbeef, 7, 9);
    expect(Number.isInteger(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(0xffffffff);
  });
});
