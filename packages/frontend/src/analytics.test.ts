import { describe, it, expect, vi } from "vitest";
import { consumeAnalyticsOptOut, umamiScriptUrl } from "./analytics";

describe("consumeAnalyticsOptOut", () => {
  it("records the opt-out and strips the marker when present", () => {
    const setItem = vi.fn();
    const cleaned = consumeAnalyticsOptOut("https://app.example.com/?umamiOptOut=1", { setItem });
    expect(setItem).toHaveBeenCalledWith("umami.disabled", "1");
    expect(cleaned).toBe("/");
  });

  it("preserves other query params, returned as a relative reference", () => {
    const setItem = vi.fn();
    const cleaned = consumeAnalyticsOptOut("https://app.example.com/play?foo=bar&umamiOptOut=1", {
      setItem,
    });
    expect(cleaned).toBe("/play?foo=bar");
  });

  it("is a no-op when the marker is absent", () => {
    const setItem = vi.fn();
    const cleaned = consumeAnalyticsOptOut("https://app.example.com/play", { setItem });
    expect(setItem).not.toHaveBeenCalled();
    expect(cleaned).toBeNull();
  });

  it("ignores a marker with an unexpected value", () => {
    const setItem = vi.fn();
    const cleaned = consumeAnalyticsOptOut("https://app.example.com/?umamiOptOut=true", {
      setItem,
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(cleaned).toBeNull();
  });
});

describe("umamiScriptUrl", () => {
  it("appends script.js to the base URL", () => {
    expect(umamiScriptUrl("https://analytics.millionpiecepuzzle.com")).toBe(
      "https://analytics.millionpiecepuzzle.com/script.js",
    );
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(umamiScriptUrl("https://analytics.millionpiecepuzzle.com/")).toBe(
      "https://analytics.millionpiecepuzzle.com/script.js",
    );
  });
});
