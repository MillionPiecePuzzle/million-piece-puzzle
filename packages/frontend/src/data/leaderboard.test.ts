import { describe, it, expect } from "vitest";
import type { LeaderboardEntry } from "@mpp/shared";
import { LEADERBOARD_LIMIT } from "@mpp/shared";
import { mergeLeaderboardDelta, toPersonalRow } from "./leaderboard";

function entry(userId: string, pieces: number): LeaderboardEntry {
  return { userId, pieces, pseudo: userId, country: null };
}

describe("mergeLeaderboardDelta", () => {
  it("replaces the row of a contributor already in the list", () => {
    const current = [entry("a", 5), entry("b", 3)];
    expect(mergeLeaderboardDelta(current, [entry("b", 4)])).toEqual([entry("a", 5), entry("b", 4)]);
  });

  it("re-sorts on the merged tallies, so a climbing contributor overtakes", () => {
    const current = [entry("a", 5), entry("b", 3)];
    expect(mergeLeaderboardDelta(current, [entry("b", 9)])).toEqual([entry("b", 9), entry("a", 5)]);
  });

  it("takes in a contributor the list had never carried", () => {
    expect(mergeLeaderboardDelta([entry("a", 5)], [entry("new", 7)])).toEqual([
      entry("new", 7),
      entry("a", 5),
    ]);
  });

  it("keeps the list at the server's own bound, dropping the row pushed out", () => {
    const full = Array.from({ length: LEADERBOARD_LIMIT }, (_, i) =>
      entry(`u${String(i).padStart(3, "0")}`, LEADERBOARD_LIMIT - i),
    );
    const merged = mergeLeaderboardDelta(full, [entry("newcomer", 50)]);
    expect(merged).toHaveLength(LEADERBOARD_LIMIT);
    expect(merged.some((e) => e.userId === "newcomer")).toBe(true);
    // The last row of the full list is the one the newcomer displaced.
    expect(merged.some((e) => e.userId === full[LEADERBOARD_LIMIT - 1]!.userId)).toBe(false);
  });

  it("leaves the list untouched on an empty delta", () => {
    const current = [entry("a", 5)];
    expect(mergeLeaderboardDelta(current, [])).toBe(current);
  });
});

describe("toPersonalRow", () => {
  it("builds the local contributor's own row from the rank the server sent", () => {
    const row = toPersonalRow(
      { pieces: 12, rank: 4312 },
      { userId: "me", pseudo: "Corentin", country: "fr" },
    );
    expect(row).toMatchObject({
      rank: 4312,
      name: "Corentin",
      country: "fr",
      pieces: 12,
      you: true,
    });
  });

  it("falls back to a user id prefix when no pseudo is set", () => {
    const row = toPersonalRow(
      { pieces: 1, rank: 900 },
      { userId: "66b1f2c3d4e5f60718293a4b", pseudo: null, country: null },
    );
    expect(row.name).toBe("66b1f2c3");
  });
});
