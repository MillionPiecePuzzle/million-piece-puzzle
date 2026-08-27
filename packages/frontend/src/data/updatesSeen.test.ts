import { describe, it, expect } from "vitest";
import { hasUnseenRelease, parseSeenVersion } from "./updatesSeen";

describe("parseSeenVersion", () => {
  it("reads a stored version back", () => {
    expect(parseSeenVersion("1.1.1")).toBe("1.1.1");
    expect(parseSeenVersion("  1.1.1  ")).toBe("1.1.1");
    expect(parseSeenVersion("1.10.0")).toBe("1.10.0");
  });

  it("returns nothing stored for a missing or unreadable value", () => {
    expect(parseSeenVersion(null)).toBeNull();
    expect(parseSeenVersion("")).toBeNull();
    expect(parseSeenVersion("v1.1.1")).toBeNull();
    expect(parseSeenVersion("1")).toBeNull();
    expect(parseSeenVersion("1.1")).toBeNull();
    expect(parseSeenVersion("1.1.1.1")).toBeNull();
    expect(parseSeenVersion("latest")).toBeNull();
    expect(parseSeenVersion("<img onerror=alert(1)>")).toBeNull();
  });
});

describe("hasUnseenRelease", () => {
  it("marks a release published since the last one read", () => {
    expect(hasUnseenRelease("1.1.0", "1.1.1")).toBe(true);
  });

  it("marks nothing once the newest release has been read", () => {
    expect(hasUnseenRelease("1.1.1", "1.1.1")).toBe(false);
  });

  it("marks nothing for a browser with nothing stored", () => {
    expect(hasUnseenRelease(null, "1.1.1")).toBe(false);
  });
});
