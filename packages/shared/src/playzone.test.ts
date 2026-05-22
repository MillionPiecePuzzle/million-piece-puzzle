import { describe, it, expect } from "vitest";
import { GRID_WORLD_CELL, computePlayZone } from "./playzone.js";

describe("computePlayZone", () => {
  it("widens, mirrors, and grid-snaps a known input", () => {
    const zone = computePlayZone(800, 600, [
      { minX: -200, minY: -100, maxX: -150, maxY: -50 },
      { minX: 900, minY: 700, maxX: 1000, maxY: 800 },
    ]);
    expect(zone).toEqual({ minX: -800, minY: -820, maxX: 1600, maxY: 1420 });
  });

  it("stays centered on the frame center", () => {
    const zone = computePlayZone(1000, 400, [{ minX: -500, minY: 50, maxX: -400, maxY: 150 }]);
    expect(zone.minX + zone.maxX).toBe(1000);
    expect(zone.minY + zone.maxY).toBe(400);
  });

  it("snaps both half-extents to the world grid", () => {
    const zone = computePlayZone(333, 777, [{ minX: -47, minY: -91, maxX: 380, maxY: 870 }]);
    expect(((zone.maxX - zone.minX) / 2) % GRID_WORLD_CELL).toBe(0);
    expect(((zone.maxY - zone.minY) / 2) % GRID_WORLD_CELL).toBe(0);
  });

  it("encloses the frame and every piece bound", () => {
    const pieces = [
      { minX: -300, minY: 200, maxX: -250, maxY: 260 },
      { minX: 1200, minY: -80, maxX: 1280, maxY: 10 },
    ];
    const zone = computePlayZone(900, 700, pieces);
    expect(zone.minX).toBeLessThanOrEqual(0);
    expect(zone.minY).toBeLessThanOrEqual(0);
    expect(zone.maxX).toBeGreaterThanOrEqual(900);
    expect(zone.maxY).toBeGreaterThanOrEqual(700);
    for (const p of pieces) {
      expect(zone.minX).toBeLessThanOrEqual(p.minX);
      expect(zone.minY).toBeLessThanOrEqual(p.minY);
      expect(zone.maxX).toBeGreaterThanOrEqual(p.maxX);
      expect(zone.maxY).toBeGreaterThanOrEqual(p.maxY);
    }
  });
});
