import { describe, expect, it } from "vitest";
import {
  boxesOverlap,
  findFreeOrigin,
  paddedWorldBox,
  ringOffsets,
  type Aabb,
} from "./freeSpot.js";

const BOUNDS: Aabb = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
// One tile and a gap on either side: the lattice pitch every case below steps by.
const TILE = 10;
const PITCH = 12;
const NO_CLAMP = (x: number, y: number): { x: number; y: number } => ({ x, y });

function search(overrides: {
  bounds?: Aabb;
  isClear: (box: Aabb) => boolean;
  hasRoom?: (box: Aabb) => boolean;
  clamp?: (x: number, y: number) => { x: number; y: number };
}) {
  return findFreeOrigin({
    bounds: overrides.bounds ?? BOUNDS,
    atX: 100,
    atY: 100,
    gap: 1,
    tileSize: TILE,
    maxRing: 3,
    clamp: overrides.clamp ?? NO_CLAMP,
    isClear: overrides.isClear,
    hasRoom: overrides.hasRoom,
  });
}

function occupiedBy(boxes: readonly Aabb[]): (box: Aabb) => boolean {
  return (box) => !boxes.some((other) => boxesOverlap(box, other));
}

describe("ringOffsets", () => {
  it("starts on the flag itself", () => {
    expect([...ringOffsets(0)]).toEqual([[0, 0]]);
  });

  it("walks whole ring borders, nearest ring first", () => {
    const offsets = [...ringOffsets(2)];
    expect(offsets).toHaveLength(1 + 8 + 16);
    const ringOf = ([x, y]: readonly [number, number]): number =>
      Math.max(Math.abs(x), Math.abs(y));
    expect(offsets.map(ringOf)).toEqual([...offsets.map(ringOf)].sort((a, b) => a - b));
    expect(new Set(offsets.map((o) => o.join(","))).size).toBe(offsets.length);
  });

  it("reads a border row by row rather than by distance", () => {
    expect([...ringOffsets(1)].slice(1)).toEqual([
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ]);
  });
});

describe("findFreeOrigin", () => {
  it("centers the cluster on the flag when the spot is clear", () => {
    expect(search({ isClear: () => true })).toEqual({ x: 95, y: 95 });
  });

  it("steps out to the next cell when the flag's own is taken", () => {
    const blocked = paddedWorldBox(BOUNDS, 95, 95, 1);
    const origin = search({ isClear: occupiedBy([blocked]) });
    expect(boxesOverlap(paddedWorldBox(BOUNDS, origin.x, origin.y, 1), blocked)).toBe(false);
    // The first cell of the border, which reading it row by row makes its
    // top-left corner, one lattice pitch out on both axes.
    expect(origin).toEqual({ x: 95 - PITCH, y: 95 - PITCH });
  });

  it("puts a cluster spanning several cells on the same lattice lines", () => {
    const single = search({ isClear: () => true });
    // Two cells wide, a gap on either side taken out, so it fills them exactly.
    const twoCells: Aabb = { minX: 0, minY: 0, maxX: PITCH * 2 - 2, maxY: 10 };
    expect(search({ bounds: twoCells, isClear: () => true }).x).toBe(single.x);
    // An odd span is centered on the flag's own cell, as a single piece is.
    const threeCells: Aabb = { minX: 0, minY: 0, maxX: PITCH * 3 - 2, maxY: 10 };
    const wide = search({ bounds: threeCells, isClear: () => true });
    expect(wide.x + (PITCH * 3 - 2) / 2).toBe(100);
    expect(wide.x).toBe(single.x - PITCH);
  });

  it("tests the clamped candidate, not the one the clamp moved off", () => {
    const blocked = paddedWorldBox(BOUNDS, 95, 95, 1);
    // The clamp pins x, so every candidate that only steps sideways lands back on
    // the flag's own occupied patch: a search testing the position before the clamp
    // would report one of them clear and return it anyway.
    const origin = findFreeOrigin({
      bounds: BOUNDS,
      atX: 100,
      atY: 100,
      gap: 1,
      tileSize: TILE,
      maxRing: 1,
      clamp: (_x, y) => ({ x: 95, y }),
      isClear: occupiedBy([blocked]),
    });
    expect(boxesOverlap(paddedWorldBox(BOUNDS, origin.x, origin.y, 1), blocked)).toBe(false);
  });

  it("lands on the flag anyway once every ring is occupied", () => {
    expect(search({ isClear: () => false })).toEqual({ x: 95, y: 95 });
  });

  it("skips a cell with no room even when it is clear", () => {
    // Room only to the right of the flag: the first clear cell there wins over
    // the flag's own, which the search never returns.
    const origin = search({ isClear: () => true, hasRoom: (box) => box.minX > 100 });
    expect(origin).toEqual({ x: 95 + PITCH, y: 95 - PITCH });
  });

  it("falls back to the first cell with room rather than to the flag", () => {
    const origin = search({ isClear: () => false, hasRoom: (box) => box.minX > 100 });
    expect(origin).toEqual({ x: 95 + PITCH, y: 95 - PITCH });
  });

  it("lands on the flag when no cell has room at all", () => {
    expect(search({ isClear: () => true, hasRoom: () => false })).toEqual({ x: 95, y: 95 });
  });
});
