import { describe, it, expect } from "vitest";
import { createLowFrameRateWatch } from "./useRenderHealth";

type FeedOptions = {
  fps: number;
  seconds: number;
  start?: number;
  ready?: boolean;
  visible?: boolean;
};

// Feeds a steady stream of frames, answering the timestamp the watch first
// raised at, or null if it never did.
function feed(
  watch: ReturnType<typeof createLowFrameRateWatch>,
  { fps, seconds, start = 0, ready = true, visible = true }: FeedOptions,
): number | null {
  const step = 1000 / fps;
  let raisedAt: number | null = null;
  for (let now = start; now < start + seconds * 1000; now += step) {
    if (watch.frame(now, ready, visible) && raisedAt === null) raisedAt = now;
  }
  return raisedAt;
}

describe("createLowFrameRateWatch", () => {
  it("stays quiet on a board that runs at full speed", () => {
    expect(feed(createLowFrameRateWatch(), { fps: 60, seconds: 120 })).toBeNull();
  });

  it("raises three seconds into an unbroken slow run, once past the warmup", () => {
    expect(feed(createLowFrameRateWatch(), { fps: 5, seconds: 60 })).toBe(8_000);
  });

  it("stays quiet on a slow stretch that recovers", () => {
    const watch = createLowFrameRateWatch();
    feed(watch, { fps: 60, seconds: 10 });
    expect(feed(watch, { fps: 5, seconds: 2.5, start: 10_000 })).toBeNull();
    expect(feed(watch, { fps: 60, seconds: 60, start: 12_500 })).toBeNull();
  });

  it("counts nothing while the board is still loading", () => {
    const watch = createLowFrameRateWatch();
    expect(feed(watch, { fps: 5, seconds: 60, ready: false })).toBeNull();
    expect(feed(watch, { fps: 5, seconds: 60, start: 60_000 })).toBe(68_000);
  });

  it("starts the wait over when the board rebuilds", () => {
    const watch = createLowFrameRateWatch();
    feed(watch, { fps: 5, seconds: 7 });
    feed(watch, { fps: 5, seconds: 1, start: 7_000, ready: false });
    expect(feed(watch, { fps: 5, seconds: 20, start: 8_000 })).toBe(16_000);
  });

  it("reads a tab that was not being serviced as paused rather than as slow", () => {
    const watch = createLowFrameRateWatch();
    feed(watch, { fps: 60, seconds: 10 });
    // One frame two minutes later, then a normal stream again.
    expect(watch.frame(130_000, true, true)).toBe(false);
    expect(feed(watch, { fps: 60, seconds: 60, start: 130_000 })).toBeNull();
  });

  it("measures nothing while the tab is hidden", () => {
    expect(feed(createLowFrameRateWatch(), { fps: 5, seconds: 60, visible: false })).toBeNull();
  });
});
