import { describe, it, expect } from "vitest";
import { DEFAULT_DISPLAY_SETTINGS, parseDisplaySettings } from "./displaySettings";

describe("parseDisplaySettings", () => {
  it("returns the defaults for missing, malformed or non-object storage", () => {
    expect(parseDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("{oops")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("[]")).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("null")).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("reads a stored boolean back", () => {
    expect(parseDisplaySettings('{"referenceUnderlay":true}')).toEqual({ referenceUnderlay: true });
    expect(parseDisplaySettings('{"referenceUnderlay":false}')).toEqual({
      referenceUnderlay: false,
    });
  });

  it("falls back to the default for a non-boolean value", () => {
    expect(parseDisplaySettings('{"referenceUnderlay":"yes"}')).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings('{"referenceUnderlay":1}')).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("ignores unknown keys", () => {
    expect(parseDisplaySettings('{"referenceUnderlay":true,"zoomLock":true}')).toEqual({
      referenceUnderlay: true,
    });
  });
});
