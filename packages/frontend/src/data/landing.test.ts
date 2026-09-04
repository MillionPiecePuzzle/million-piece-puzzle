import { describe, it, expect } from "vitest";
import { backendRetryDelayMs, eventGateOpen, offerFigures, type Figures } from "./landing";

function figures(figuresAt: number, locked: number): Figures {
  return {
    figuresAt,
    progress: { locked, total: 1000 },
    leaderboard: [{ userId: "u1", pseudo: "Alice", country: "fr", pieces: locked }],
    activity: [],
  };
}

function unstamped(locked: number): Figures {
  const body = figures(0, locked) as Partial<Figures>;
  delete body.figuresAt;
  return body as Figures;
}

// One sequence rather than a case each: the freshest body is module state that
// lives as long as the page load, which is the whole point of it (a landing
// remounted from /play reads it back).
describe("offerFigures", () => {
  it("holds the freshest body a page load has seen, whatever order they arrive in", () => {
    // A server that does not stamp its figures yet (the frontend deploys ahead of
    // the backend): every body wins, as they did before the stamp existed.
    expect(offerFigures(unstamped(10)).progress.locked).toBe(10);
    expect(offerFigures(unstamped(9)).progress.locked).toBe(9);
    expect(offerFigures(figures(1000, 120)).progress.locked).toBe(120);
    // A newer read moves it forward.
    expect(offerFigures(figures(2000, 130)).progress.locked).toBe(130);
    // An edge-cached poll answering with an older body leaves it alone, standings
    // included: the body loses whole, it is not merged.
    const older = offerFigures(figures(1500, 125));
    expect(older.progress.locked).toBe(130);
    expect(older.leaderboard[0]?.pieces).toBe(130);
    // A board reset counts down, and applies: its body is stamped later.
    expect(offerFigures(figures(3000, 0)).progress.locked).toBe(0);
  });
});

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
