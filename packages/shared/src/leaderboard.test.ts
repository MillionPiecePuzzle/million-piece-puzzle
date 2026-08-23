import { describe, it, expect } from "vitest";
import { LeaderboardTracker, type LeaderboardScoreRow } from "./leaderboard.js";
import { mulberry32, seedFromString } from "./generator/prng.js";

describe("LeaderboardTracker", () => {
  it("rebuildFromLog tallies one point per row, grouped by user", () => {
    const tracker = new LeaderboardTracker(10);
    tracker.rebuildFromLog([
      { pieceId: 0, userId: "u1" },
      { pieceId: 1, userId: "u1" },
      { pieceId: 2, userId: "u2" },
    ]);
    expect(tracker.top(10)).toEqual([
      { userId: "u1", pieces: 2 },
      { userId: "u2", pieces: 1 },
    ]);
  });

  it("rebuildFromLog keeps only the first row seen per piece", () => {
    const tracker = new LeaderboardTracker(10);
    // Mongo's $sort:{at:1} orders rows oldest-first before the $group:$first
    // dedup, so a later duplicate row for the same piece must lose here too.
    tracker.rebuildFromLog([
      { pieceId: 0, userId: "u1" },
      { pieceId: 0, userId: "u2" },
    ]);
    expect(tracker.top(10)).toEqual([{ userId: "u1", pieces: 1 }]);
  });

  it("recordDrop credits only the first-ever drop of a piece", () => {
    const tracker = new LeaderboardTracker(10);
    tracker.recordDrop("u1", [0, 1]);
    // Piece 0 was already scored to u1; only piece 2 is new here.
    tracker.recordDrop("u2", [0, 2]);
    expect(tracker.top(10)).toEqual([
      { userId: "u1", pieces: 2 },
      { userId: "u2", pieces: 1 },
    ]);
  });

  it("is a no-op on the tally when every dropped piece was already scored", () => {
    const tracker = new LeaderboardTracker(10);
    tracker.recordDrop("u1", [0, 1]);
    tracker.recordDrop("u2", [0, 1]);
    expect(tracker.top(10)).toEqual([{ userId: "u1", pieces: 2 }]);
  });

  it("top() sorts by pieces descending, ties broken by userId ascending", () => {
    const tracker = new LeaderboardTracker(10);
    tracker.rebuildFromLog([
      { pieceId: 0, userId: "b" },
      { pieceId: 1, userId: "a" },
      { pieceId: 2, userId: "c" },
      { pieceId: 3, userId: "c" },
    ]);
    expect(tracker.top(10)).toEqual([
      { userId: "c", pieces: 2 },
      { userId: "a", pieces: 1 },
      { userId: "b", pieces: 1 },
    ]);
  });

  it("top() respects the limit", () => {
    const tracker = new LeaderboardTracker(10);
    tracker.rebuildFromLog([
      { pieceId: 0, userId: "u1" },
      { pieceId: 1, userId: "u2" },
      { pieceId: 2, userId: "u3" },
    ]);
    expect(tracker.top(2)).toHaveLength(2);
  });

  // Drift check: a long random sequence of merges (each dropping a random,
  // possibly-overlapping piece set for a random user) replayed incrementally
  // via recordDrop, compared after every single step against a from-scratch
  // rebuildFromLog fed the same raw sequence reduced to one first-dropper row
  // per piece (the same $sort:at:1 + $group:$first reduction the Mongo
  // aggregation performs). Any divergence means the incremental path
  // disagrees with the log it is supposed to mirror.
  it("never drifts from a from-scratch rebuild over a random merge sequence", () => {
    const rng = mulberry32(seedFromString("leaderboard-drift-check"));
    const totalPieces = 60;
    const users = ["u1", "u2", "u3", "u4", "u5"];
    const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;

    const tracker = new LeaderboardTracker(totalPieces);
    const firstDropper = new Map<number, string>();

    for (let step = 0; step < 300; step++) {
      const userId = pick(users);
      const dropCount = 1 + Math.floor(rng() * 5);
      const pieceIds = Array.from({ length: dropCount }, () => Math.floor(rng() * totalPieces));

      tracker.recordDrop(userId, pieceIds);
      for (const id of pieceIds) {
        if (!firstDropper.has(id)) firstDropper.set(id, userId);
      }

      const rows: LeaderboardScoreRow[] = [...firstDropper.entries()].map(
        ([pieceId, dropperId]) => ({ pieceId, userId: dropperId }),
      );
      const fromScratch = new LeaderboardTracker(totalPieces);
      fromScratch.rebuildFromLog(rows);

      expect(tracker.top(users.length)).toEqual(fromScratch.top(users.length));
    }
  });
});

describe("reassign", () => {
  it("moves a folded guest's tally onto the account that claimed it", () => {
    const t = new LeaderboardTracker(10);
    t.recordDrop("guest", [0, 1, 2]);
    t.recordDrop("account", [3]);
    t.reassign("guest", "account");
    expect(t.top(10)).toEqual([{ userId: "account", pieces: 4 }]);
  });

  it("carries the tally over when the account had none, and ignores an unknown guest", () => {
    const t = new LeaderboardTracker(10);
    t.recordDrop("guest", [0, 1]);
    t.reassign("guest", "account");
    t.reassign("nobody", "account");
    expect(t.top(10)).toEqual([{ userId: "account", pieces: 2 }]);
  });
});
