import { describe, it, expect } from "vitest";
import {
  DEFAULT_DISPLAY_SETTINGS,
  isPanelAvailable,
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
      parseDisplaySettings(
        '{"panels":{"overview":false,"contributors":true,"radar":true,"zoom":1}}',
      ),
    ).toEqual({ referenceUnderlay: true, panels: { overview: false, contributors: true } });
    expect(parseDisplaySettings('{"panels":"all"}')).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings('{"panels":null}')).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });
});

describe("isPanelAvailable", () => {
  it("keeps every panel on a full viewport and the board-first pair on a compact one", () => {
    expect(isPanelAvailable("contributors", false)).toBe(true);
    expect(isPanelAvailable("flags", false)).toBe(true);
    expect(isPanelAvailable("reference", true)).toBe(true);
    expect(isPanelAvailable("overview", true)).toBe(true);
    expect(isPanelAvailable("contributors", true)).toBe(false);
    expect(isPanelAvailable("activity", true)).toBe(false);
    expect(isPanelAvailable("zoom", true)).toBe(false);
    expect(isPanelAvailable("flags", true)).toBe(false);
  });
});

describe("isPanelVisible", () => {
  const untouched: DisplaySettings = { referenceUnderlay: true, panels: {} };

  it("draws every panel it has room for until the player says otherwise", () => {
    expect(isPanelVisible(untouched, "contributors", false)).toBe(true);
    expect(isPanelVisible(untouched, "flags", false)).toBe(true);
    expect(isPanelVisible(untouched, "reference", true)).toBe(true);
    expect(isPanelVisible(untouched, "overview", true)).toBe(true);
  });

  it("reads a stored choice back, and never over a panel this viewport cannot hold", () => {
    const chosen: DisplaySettings = {
      referenceUnderlay: true,
      panels: { contributors: true, overview: false },
    };
    expect(isPanelVisible(chosen, "contributors", false)).toBe(true);
    expect(isPanelVisible(chosen, "contributors", true)).toBe(false);
    expect(isPanelVisible(chosen, "overview", false)).toBe(false);
    expect(isPanelVisible(chosen, "overview", true)).toBe(false);
  });
});
