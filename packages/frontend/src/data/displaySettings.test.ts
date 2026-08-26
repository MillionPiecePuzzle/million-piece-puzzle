import { describe, it, expect } from "vitest";
import {
  DEFAULT_DISPLAY_SETTINGS,
  isPanelVisible,
  parseDisplaySettings,
  type DisplaySettings,
} from "./displaySettings";

describe("parseDisplaySettings", () => {
  it("returns the defaults for missing, malformed or non-object storage", () => {
    expect(parseDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("{oops")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("[]")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("null")).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("reads a stored boolean back", () => {
    expect(parseDisplaySettings('{"referenceUnderlay":true}')).toEqual({
      referenceUnderlay: true,
      panels: {},
    });
    expect(parseDisplaySettings('{"referenceUnderlay":false}')).toEqual({
      referenceUnderlay: false,
      panels: {},
    });
  });

  it("falls back to the default for a non-boolean value", () => {
    expect(parseDisplaySettings('{"referenceUnderlay":"yes"}')).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings('{"referenceUnderlay":1}')).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("ignores unknown keys", () => {
    expect(parseDisplaySettings('{"referenceUnderlay":true,"zoomLock":true}')).toEqual({
      referenceUnderlay: true,
      panels: {},
    });
  });

  it("keeps only the known panels, and only when they hold a boolean", () => {
    expect(
      parseDisplaySettings('{"panels":{"minimap":false,"leaderboard":true,"radar":true,"zoom":1}}'),
    ).toEqual({ referenceUnderlay: true, panels: { minimap: false, leaderboard: true } });
    expect(parseDisplaySettings('{"panels":"all"}')).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings('{"panels":null}')).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });
});

describe("isPanelVisible", () => {
  const untouched: DisplaySettings = { referenceUnderlay: true, panels: {} };

  it("shows every panel on a wide viewport and only the board-first pair on a narrow one", () => {
    expect(isPanelVisible(untouched, "leaderboard", true)).toBe(true);
    expect(isPanelVisible(untouched, "flags", true)).toBe(true);
    expect(isPanelVisible(untouched, "reference", false)).toBe(true);
    expect(isPanelVisible(untouched, "minimap", false)).toBe(true);
    expect(isPanelVisible(untouched, "leaderboard", false)).toBe(false);
    expect(isPanelVisible(untouched, "zoom", false)).toBe(false);
  });

  it("lets a stored choice override the viewport default either way", () => {
    const chosen: DisplaySettings = {
      referenceUnderlay: true,
      panels: { leaderboard: true, minimap: false },
    };
    expect(isPanelVisible(chosen, "leaderboard", false)).toBe(true);
    expect(isPanelVisible(chosen, "minimap", false)).toBe(false);
    expect(isPanelVisible(chosen, "minimap", true)).toBe(false);
  });
});
