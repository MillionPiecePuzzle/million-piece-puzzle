import { describe, it, expect } from "vitest";
import { eventGateOpen } from "./landing";

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
