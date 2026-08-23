import { describe, it, expect } from "vitest";
import { backendRetryDelayMs, eventGateOpen } from "./landing";

describe("eventGateOpen", () => {
  it("opens when no start is scheduled (0)", () => {
    expect(eventGateOpen(0, 1000)).toBe(true);
  });

  it("opens when the start is unknown (fetch failed)", () => {
    expect(eventGateOpen(null, 1000)).toBe(true);
  });

  it("seals while a future start has not been reached", () => {
    expect(eventGateOpen(5000, 1000)).toBe(false);
  });

  it("opens the instant the start is reached", () => {
    expect(eventGateOpen(1000, 1000)).toBe(true);
  });

  it("opens for a start already in the past", () => {
    expect(eventGateOpen(500, 1000)).toBe(true);
  });
});

describe("backendRetryDelayMs", () => {
  it("spreads retries across the window", () => {
    expect(backendRetryDelayMs(() => 0)).toBe(8_000);
    expect(backendRetryDelayMs(() => 0.5)).toBe(12_000);
    // Math.random() never returns 1, so the top of the window is the limit.
    expect(backendRetryDelayMs(() => 0.999)).toBeLessThan(16_000);
  });

  it("never returns a delay that would hammer the returning server", () => {
    for (let i = 0; i < 50; i++) {
      const delay = backendRetryDelayMs();
      expect(delay).toBeGreaterThanOrEqual(8_000);
      expect(delay).toBeLessThan(16_000);
    }
  });
});
