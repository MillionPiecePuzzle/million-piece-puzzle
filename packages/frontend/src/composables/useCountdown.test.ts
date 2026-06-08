import { describe, it, expect, vi, afterEach } from "vitest";
import { ref } from "vue";
import { formatCountdown, useCountdown } from "./useCountdown";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatCountdown", () => {
  it("zero-pads each field to two digits", () => {
    expect(formatCountdown(5 * DAY + 3 * HOUR + 7 * MIN + 9 * SEC)).toEqual({
      days: "05",
      hours: "03",
      minutes: "07",
      seconds: "09",
    });
  });

  it("does not cap days at two digits", () => {
    expect(formatCountdown(123 * DAY).days).toBe("123");
  });

  it("floors sub-second remainders", () => {
    expect(formatCountdown(9 * SEC + 999)).toMatchObject({ seconds: "09" });
  });

  it("clamps a negative remaining to all zeros", () => {
    expect(formatCountdown(-5000)).toEqual({
      days: "00",
      hours: "00",
      minutes: "00",
      seconds: "00",
    });
  });

  it("rolls fields over at their boundaries", () => {
    expect(formatCountdown(DAY - SEC)).toEqual({
      days: "00",
      hours: "23",
      minutes: "59",
      seconds: "59",
    });
  });
});

describe("useCountdown state", () => {
  // The immediate watcher may schedule a 1s ticker; fake timers keep it from
  // leaking past the test (the static states are read synchronously at creation).
  afterEach(() => vi.useRealTimers());

  it("is neither scheduled nor launched with no date", () => {
    vi.useFakeTimers();
    const { scheduled, launched } = useCountdown(ref(0), () => 1000);
    expect(scheduled.value).toBe(false);
    expect(launched.value).toBe(false);
  });

  it("is scheduled but not launched before a future start", () => {
    vi.useFakeTimers();
    const { scheduled, launched } = useCountdown(ref(5000), () => 1000);
    expect(scheduled.value).toBe(true);
    expect(launched.value).toBe(false);
  });

  it("is launched but not scheduled once the start is reached", () => {
    vi.useFakeTimers();
    const { scheduled, launched } = useCountdown(ref(1000), () => 1000);
    expect(launched.value).toBe(true);
    expect(scheduled.value).toBe(false);
  });

  it("treats a start already in the past as launched", () => {
    vi.useFakeTimers();
    const { launched } = useCountdown(ref(500), () => 1000);
    expect(launched.value).toBe(true);
  });
});
