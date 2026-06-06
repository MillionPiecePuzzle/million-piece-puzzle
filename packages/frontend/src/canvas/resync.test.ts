import { describe, it, expect } from "vitest";
import { resyncShouldApply } from "./resync";

const none = new Set<number>();

describe("resyncShouldApply", () => {
  it("applies a resync to a group the client is not the live authority for", () => {
    expect(resyncShouldApply(7, null, none, none)).toBe(true);
  });

  it("skips the group the client is holding (would yank it out of hand)", () => {
    expect(resyncShouldApply(7, 7, none, none)).toBe(false);
  });

  it("skips a group a peer is holding (its live drag is authoritative)", () => {
    expect(resyncShouldApply(7, null, new Set([7]), none)).toBe(false);
  });

  it("skips a group with an unconfirmed local drop (a stale resync would rewind it)", () => {
    expect(resyncShouldApply(7, null, none, new Set([7]))).toBe(false);
  });

  it("still applies to other groups while one is held or pending", () => {
    expect(resyncShouldApply(8, 7, new Set([9]), new Set([10]))).toBe(true);
  });
});
