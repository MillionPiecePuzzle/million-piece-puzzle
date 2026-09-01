import { describe, it, expect } from "vitest";
import { createLowFrameRateWatch } from "./useRenderHealth";

type Phase = {
  fps: number;
  seconds: number;
  start?: number;
  ready?: boolean;
  tabVisible?: boolean;
};

// Feeds steady streams of frames into one watch, answering the notice's whole
// timeline: the timestamps it appeared and disappeared at, across every phase
// fed so far.
function probe() {
  const watch = createLowFrameRateWatch();
  const timeline: { at: number; showing: boolean }[] = [];
  let showing = false;

  function frame(now: number, ready = true, tabVisible = true): boolean {
    const next = watch.frame(now, ready, tabVisible);
    if (next !== showing) {
      showing = next;
      timeline.push({ at: now, showing: next });
    }
    return next;
  }

  function feed({ fps, seconds, start = 0, ready = true, tabVisible = true }: Phase) {
    const step = 1000 / fps;
    for (let now = start; now < start + seconds * 1000; now += step) frame(now, ready, tabVisible);
    return timeline;
  }

  return { frame, feed };
}

describe("createLowFrameRateWatch", () => {
  it("stays quiet on a board that runs at full speed", () => {
    expect(probe().feed({ fps: 60, seconds: 120 })).toEqual([]);
  });

  it("raises three seconds into an unbroken slow run, once past the warmup", () => {
    expect(probe().feed({ fps: 5, seconds: 60 })).toEqual([{ at: 8_000, showing: true }]);
  });

  it("stays quiet on a slow stretch that recovers", () => {
    const p = probe();
    p.feed({ fps: 60, seconds: 10 });
    p.feed({ fps: 5, seconds: 2.5, start: 10_000 });
    expect(p.feed({ fps: 60, seconds: 60, start: 12_500 })).toEqual([]);
  });

  it("counts nothing while the board is still loading", () => {
    const p = probe();
    p.feed({ fps: 5, seconds: 60, ready: false });
    expect(p.feed({ fps: 5, seconds: 60, start: 60_000 })).toEqual([{ at: 68_000, showing: true }]);
  });

  it("starts the wait over when the board rebuilds", () => {
    const p = probe();
    p.feed({ fps: 5, seconds: 7 });
    p.feed({ fps: 5, seconds: 1, start: 7_000, ready: false });
    expect(p.feed({ fps: 5, seconds: 20, start: 8_000 })).toEqual([{ at: 16_000, showing: true }]);
  });

  it("reads a tab that was not being serviced as paused rather than as slow", () => {
    const p = probe();
    p.feed({ fps: 60, seconds: 10 });
    // One frame two minutes later, then a normal stream again.
    expect(p.frame(130_000)).toBe(false);
    expect(p.feed({ fps: 60, seconds: 60, start: 130_000 })).toEqual([]);
  });

  it("measures nothing while the tab is hidden", () => {
    expect(probe().feed({ fps: 5, seconds: 60, tabVisible: false })).toEqual([]);
  });

  it("takes the notice back down three seconds into a run at speed", () => {
    const p = probe();
    p.feed({ fps: 5, seconds: 20 });
    expect(p.feed({ fps: 50, seconds: 20, start: 20_000 })).toEqual([
      { at: 8_000, showing: true },
      { at: 23_020, showing: false },
    ]);
  });

  it("holds the notice its five seconds when the frames come straight back", () => {
    const p = probe();
    p.feed({ fps: 5, seconds: 8.2 });
    expect(p.feed({ fps: 50, seconds: 10, start: 8_020 })).toEqual([
      { at: 8_000, showing: true },
      { at: 13_000, showing: false },
    ]);
  });

  it("keeps the notice away thirty seconds after it goes, however slow the board", () => {
    const p = probe();
    p.feed({ fps: 5, seconds: 8.2 });
    p.feed({ fps: 50, seconds: 5, start: 8_020 });
    expect(p.feed({ fps: 5, seconds: 60, start: 13_200 })).toEqual([
      { at: 8_000, showing: true },
      { at: 13_000, showing: false },
      { at: 43_000, showing: true },
    ]);
  });
});
