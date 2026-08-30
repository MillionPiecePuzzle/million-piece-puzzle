import { describe, it, expect } from "vitest";
import { countryName } from "./countryNames";

describe("countryName", () => {
  it("labels a stored lower-case code in the asked locale", () => {
    expect(countryName("de", "fr-FR", "International")).toBe("Allemagne");
    expect(countryName("de", "en-US", "International")).toBe("Germany");
    expect(countryName("us", "es-ES", "International")).toBe("Estados Unidos");
  });

  it("answers the app's own label for the international opt-out", () => {
    // CLDR knows "UN" as the United Nations, which is not what it means here.
    expect(countryName("un", "en-US", "Worldwide")).toBe("Worldwide");
  });

  it("falls back to the dataset's English name when Intl cannot serve the locale", () => {
    expect(countryName("de", "not a tag", "International")).toBe("Germany");
  });

  it("falls back to the code itself for a region neither side knows", () => {
    expect(countryName("qq", "en-US", "International")).toBe("QQ");
  });
});
