import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./useRelativeTime";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function mockT(key: string, params?: Record<string, unknown>): string {
  return params ? `${key}:${JSON.stringify(params)}` : key;
}

describe("formatRelativeTime", () => {
  it("reads as just now under 10s", () => {
    expect(formatRelativeTime(9 * SEC, mockT)).toBe("time.justNow");
  });

  it("switches to seconds at the 10s boundary", () => {
    expect(formatRelativeTime(10 * SEC, mockT)).toBe('time.secondsAgo:{"n":10}');
  });

  it("switches to minutes at the 60s boundary", () => {
    expect(formatRelativeTime(60 * SEC, mockT)).toBe('time.minutesAgo:{"n":1}');
  });

  it("switches to hours at the 60min boundary", () => {
    expect(formatRelativeTime(60 * MIN, mockT)).toBe('time.hoursAgo:{"n":1}');
  });

  it("switches to days at the 24h boundary", () => {
    expect(formatRelativeTime(24 * HOUR, mockT)).toBe('time.daysAgo:{"n":1}');
  });

  it("does not cap at hours forever", () => {
    expect(formatRelativeTime(3 * DAY, mockT)).toBe('time.daysAgo:{"n":3}');
  });

  it("clamps a negative elapsed to just now", () => {
    expect(formatRelativeTime(-5000, mockT)).toBe("time.justNow");
  });

  it("rounds sub-second remainders before thresholding", () => {
    expect(formatRelativeTime(9500, mockT)).toBe('time.secondsAgo:{"n":10}');
  });
});
