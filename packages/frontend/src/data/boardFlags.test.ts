import { describe, it, expect } from "vitest";
import {
  MAX_FLAGS,
  addFlag,
  firstFreeColor,
  moveFlag,
  parseFlags,
  recolorFlag,
  removeFlag,
  type BoardFlag,
} from "./boardFlags";

function fill(count: number): BoardFlag[] {
  let flags: BoardFlag[] = [];
  for (let i = 0; i < count; i++) flags = addFlag(flags, i, i);
  return flags;
}

describe("addFlag", () => {
  it("hands every flag the first color no other one holds", () => {
    expect(fill(3).map((f) => f.color)).toEqual([0, 1, 2]);
  });

  it("reuses the color a deleted flag gave back", () => {
    const flags = fill(3);
    expect(firstFreeColor(removeFlag(flags, flags[1]!.id))).toBe(1);
  });

  it("refuses to grow past the cap", () => {
    const full = fill(MAX_FLAGS);
    expect(addFlag(full, 9, 9)).toHaveLength(MAX_FLAGS);
  });

  it("mints distinct ids", () => {
    const ids = new Set(fill(MAX_FLAGS).map((f) => f.id));
    expect(ids.size).toBe(MAX_FLAGS);
  });
});

describe("recolorFlag", () => {
  it("swaps with the flag already holding the wanted color", () => {
    const flags = fill(3);
    const next = recolorFlag(flags, flags[0]!.id, 2);
    expect(next.map((f) => f.color)).toEqual([2, 1, 0]);
  });

  it("takes a free color without touching anyone else", () => {
    const flags = fill(2);
    const next = recolorFlag(flags, flags[0]!.id, 5);
    expect(next.map((f) => f.color)).toEqual([5, 1]);
  });

  it("ignores an out-of-range color", () => {
    const flags = fill(2);
    expect(recolorFlag(flags, flags[0]!.id, MAX_FLAGS)).toEqual(flags);
    expect(recolorFlag(flags, flags[0]!.id, -1)).toEqual(flags);
  });
});

describe("moveFlag", () => {
  it("moves only the named flag", () => {
    const flags = fill(2);
    const next = moveFlag(flags, flags[1]!.id, 40, 50);
    expect(next[0]).toEqual(flags[0]);
    expect(next[1]).toMatchObject({ worldX: 40, worldY: 50 });
  });
});

describe("parseFlags", () => {
  it("reads back what was stored", () => {
    const flags = fill(2);
    expect(parseFlags(JSON.stringify(flags))).toEqual(flags);
  });

  it("answers empty for absent or malformed storage", () => {
    expect(parseFlags(null)).toEqual([]);
    expect(parseFlags("{")).toEqual([]);
    expect(parseFlags('{"a":1}')).toEqual([]);
  });

  it("drops entries that are not placeable points", () => {
    const raw = JSON.stringify([
      { id: "a", worldX: 1, worldY: 2, color: 0 },
      { id: "b", worldX: "x", worldY: 2, color: 1 },
      { id: "c", worldX: 1, color: 2 },
      { id: "", worldX: 1, worldY: 2, color: 3 },
    ]);
    expect(parseFlags(raw).map((f) => f.id)).toEqual(["a"]);
  });

  it("repairs duplicate and invalid colors into a permutation", () => {
    const raw = JSON.stringify([
      { id: "a", worldX: 0, worldY: 0, color: 3 },
      { id: "b", worldX: 0, worldY: 0, color: 3 },
      { id: "c", worldX: 0, worldY: 0, color: 99 },
    ]);
    expect(parseFlags(raw).map((f) => f.color)).toEqual([3, 0, 1]);
  });

  it("cuts a stored list down to the cap", () => {
    const raw = JSON.stringify(
      Array.from({ length: MAX_FLAGS + 4 }, (_, i) => ({
        id: `f${i}`,
        worldX: i,
        worldY: i,
        color: i % MAX_FLAGS,
      })),
    );
    expect(parseFlags(raw)).toHaveLength(MAX_FLAGS);
  });

  it("drops a duplicate id", () => {
    const raw = JSON.stringify([
      { id: "a", worldX: 0, worldY: 0, color: 0 },
      { id: "a", worldX: 5, worldY: 5, color: 1 },
    ]);
    expect(parseFlags(raw)).toHaveLength(1);
  });
});
