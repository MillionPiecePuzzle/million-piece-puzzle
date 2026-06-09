import { describe, it, expect } from "vitest";
import { validateGeneration } from "./validate.js";

describe("validateGeneration", () => {
  it("rejects non-positive dimensions", () => {
    expect(() => validateGeneration({ seed: "s", rows: 0, cols: 3 })).toThrow();
    expect(() => validateGeneration({ seed: "s", rows: 3, cols: 0 })).toThrow();
  });

  it("reports a clean 2x2 puzzle with four unique interior edges", () => {
    const report = validateGeneration({ seed: "s", rows: 2, cols: 2 });
    expect(report.pieces).toBe(4);
    expect(report.interiorEdges).toBe(4);
    expect(report.uniqueEdges).toBe(4);
    expect(report.violationCount).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("counts no interior edges for a single all-flat piece", () => {
    const report = validateGeneration({ seed: "s", rows: 1, cols: 1 });
    expect(report.pieces).toBe(1);
    expect(report.interiorEdges).toBe(0);
    expect(report.uniqueEdges).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("counts only the shared edges that exist in a single row", () => {
    const report = validateGeneration({ seed: "s", rows: 1, cols: 3 });
    expect(report.interiorEdges).toBe(2);
    expect(report.uniqueEdges).toBe(2);
    expect(report.ok).toBe(true);
  });
});
