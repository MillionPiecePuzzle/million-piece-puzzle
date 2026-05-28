import { describe, it, expect } from "vitest";
import type { ImageManifest } from "@mpp/shared";
import { scatteredLayout } from "./init.js";

function manifest(rows: number, cols: number): ImageManifest {
  const pieceSize = 100;
  return {
    puzzleId: "test",
    name: "test",
    seed: "scatter-test",
    rows,
    cols,
    pieceSize,
    margin: 35,
    tileSize: pieceSize + 70,
    source: { dzi: "", width: cols * pieceSize, height: rows * pieceSize },
    pieces: [],
  };
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return cov / Math.sqrt(va * vb);
}

describe("scatter", () => {
  it("places no piece body inside the frame interior", () => {
    const { geom, worldW, worldH, placements } = scatteredLayout(manifest(40, 60));
    for (const p of placements) {
      const minX = p.worldX + p.canonicalOffset.x;
      const minY = p.worldY + p.canonicalOffset.y;
      const overlapsFrame =
        minX + geom.pieceSize > 0 && minX < worldW && minY + geom.pieceSize > 0 && minY < worldH;
      expect(overlapsFrame).toBe(false);
    }
  });

  it("decorrelates the scattered body from the solved cell", () => {
    const { geom, placements } = scatteredLayout(manifest(40, 60));
    const rows = placements.map((_, i) => geom.pieces[i].row);
    const cols = placements.map((_, i) => geom.pieces[i].col);
    const bodyY = placements.map((p) => p.worldY + p.canonicalOffset.y);
    const bodyX = placements.map((p) => p.worldX + p.canonicalOffset.x);
    expect(Math.abs(pearson(rows, bodyY))).toBeLessThan(0.1);
    expect(Math.abs(pearson(cols, bodyX))).toBeLessThan(0.1);
  });

  it("is deterministic for a given seed", () => {
    const a = scatteredLayout(manifest(10, 10)).placements;
    const b = scatteredLayout(manifest(10, 10)).placements;
    expect(a).toEqual(b);
  });
});
