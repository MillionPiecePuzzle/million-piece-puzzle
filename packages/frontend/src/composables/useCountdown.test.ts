import { describe, it, expect } from "vitest";
import { formatCountdown } from "./useCountdown";

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
