import { describe, it, expect } from "vitest";
import { flooredPercent } from "./format";

const BOARD = 1_000_000;

describe("flooredPercent", () => {
  it("never reads as done while a single piece is missing", () => {
    for (let locked = BOARD - 5_000; locked < BOARD; locked++) {
      expect(flooredPercent(locked, BOARD, 3), String(locked)).toBeLessThan(100);
    }
    expect(flooredPercent(BOARD - 1, BOARD, 3)).toBe(99.999);
    expect(flooredPercent(BOARD - 501, BOARD, 3)).toBe(99.949);
  });

  it("reaches 100 on the last piece", () => {
    expect(flooredPercent(BOARD, BOARD, 3)).toBe(100);
    expect(flooredPercent(12, 12, 3)).toBe(100);
  });

  it("floors instead of rounding at the bottom of the scale", () => {
    expect(flooredPercent(63, BOARD, 3)).toBe(0.006);
    expect(flooredPercent(9, BOARD, 3)).toBe(0);
    expect(flooredPercent(10, BOARD, 3)).toBe(0.001);
  });

  // Math.floor(pct * 1000) / 1000 on the float percentage is one step low on
  // 12 218 of the 1M board's counts. These three are the first offender at each
  // board size.
  it("floors the exact ratio, not its float percentage", () => {
    expect(flooredPercent(70, BOARD, 3)).toBe(0.007);
    expect(flooredPercent(7, 10_000, 3)).toBe(0.07);
    expect(flooredPercent(9, 1_000, 3)).toBe(0.9);
  });

  it("answers 0 for a board with no pieces", () => {
    expect(flooredPercent(0, 0, 3)).toBe(0);
  });

  it("clamps a count that runs past the board", () => {
    expect(flooredPercent(BOARD + 1, BOARD, 3)).toBe(100);
  });

  it("honours the requested precision", () => {
    expect(flooredPercent(BOARD - 1, BOARD, 1)).toBe(99.9);
    expect(flooredPercent(BOARD - 1, BOARD, 2)).toBe(99.99);
  });
});
