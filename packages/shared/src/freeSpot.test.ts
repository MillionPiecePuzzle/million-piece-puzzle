import { describe, expect, it } from "vitest";
import {
  boxesOverlap,
  findFreeOrigin,
  paddedWorldBox,
  ringOffsets,
  type Aabb,
} from "./freeSpot.js";

const BOUNDS: Aabb = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const NO_CLAMP = (x: number, y: number): { x: number; y: number } => ({ x, y });

function search(overrides: {
  isClear: (box: Aabb) => boolean;
  hasRoom?: (box: Aabb) => boolean;
  clamp?: (x: number, y: number) => { x: number; y: number };
}) {
  return findFreeOrigin({
    bounds: BOUNDS,
    atX: 100,
    atY: 100,
    gap: 1,
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
});

describe("findFreeOrigin", () => {
  it("centers the cluster on the flag when the spot is clear", () => {
    expect(search({ isClear: () => true })).toEqual({ x: 95, y: 95 });
  });

  it("steps out to the next patch when the flag's own is taken", () => {
    const blocked = paddedWorldBox(BOUNDS, 95, 95, 1);
    const origin = search({ isClear: occupiedBy([blocked]) });
    expect(boxesOverlap(paddedWorldBox(BOUNDS, origin.x, origin.y, 1), blocked)).toBe(false);
    // One patch out: the cluster's own extent plus a gap on either side.
    expect(Math.max(Math.abs(origin.x - 95), Math.abs(origin.y - 95))).toBe(12);
  });

  it("prefers a side of the ring over a corner", () => {
    const blocked = paddedWorldBox(BOUNDS, 95, 95, 1);
    const origin = search({ isClear: occupiedBy([blocked]) });
    expect([Math.abs(origin.x - 95), Math.abs(origin.y - 95)]).toContain(0);
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
      maxRing: 1,
      clamp: (_x, y) => ({ x: 95, y }),
      isClear: occupiedBy([blocked]),
    });
    expect(boxesOverlap(paddedWorldBox(BOUNDS, origin.x, origin.y, 1), blocked)).toBe(false);
  });

  it("lands on the flag anyway once every ring is occupied", () => {
    expect(search({ isClear: () => false })).toEqual({ x: 95, y: 95 });
  });

  it("skips a patch with no room even when it is clear", () => {
    // Room only to the right of the flag: the first clear patch there wins over
    // the flag's own, which the search never returns.
    const origin = search({ isClear: () => true, hasRoom: (box) => box.minX > 100 });
    expect(origin).toEqual({ x: 107, y: 95 });
  });

  it("falls back to the nearest patch with room rather than to the flag", () => {
    const origin = search({ isClear: () => false, hasRoom: (box) => box.minX > 100 });
    expect(origin).toEqual({ x: 107, y: 95 });
  });

  it("lands on the flag when no patch has room at all", () => {
    expect(search({ isClear: () => true, hasRoom: () => false })).toEqual({ x: 95, y: 95 });
  });
});
