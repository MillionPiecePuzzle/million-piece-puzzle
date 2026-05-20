import { describe, it, expect } from "vitest";
import { normalizePseudo, PSEUDO_MAX_LENGTH } from "./session.js";

describe("normalizePseudo", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normalizePseudo("  ada   lovelace  ")).toBe("ada lovelace");
  });

  it("accepts letters, digits, spaces, hyphens and underscores", () => {
    expect(normalizePseudo("piece_master-9")).toBe("piece_master-9");
  });

  it("accepts accented letters", () => {
    expect(normalizePseudo("Renée")).toBe("Renée");
  });

  it("rejects a value shorter than the minimum", () => {
    expect(normalizePseudo("a")).toBeNull();
    expect(normalizePseudo("   x   ")).toBeNull();
  });

  it("rejects a value longer than the maximum", () => {
    expect(normalizePseudo("x".repeat(PSEUDO_MAX_LENGTH + 1))).toBeNull();
  });

  it("rejects disallowed characters", () => {
    expect(normalizePseudo("hello!")).toBeNull();
    expect(normalizePseudo("drop@table")).toBeNull();
    expect(normalizePseudo("emoji 🧩 here")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizePseudo(42)).toBeNull();
    expect(normalizePseudo(null)).toBeNull();
    expect(normalizePseudo(undefined)).toBeNull();
  });
});
