import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LeaderboardTracker, type LeaderboardStanding } from "@mpp/shared";
import { LeaderboardBroadcaster } from "./leaderboardBroadcast.js";
import type { Client } from "./hub.js";

const INTERVAL_MS = 50;

function makeBroadcaster(tracker: LeaderboardTracker, limit: number, userIds: string[] = []) {
  const broadcast = vi.fn();
  const send = vi.fn();
  const clients = userIds.map((userId) => ({ userId }) as unknown as Client);
  const attachProfiles = vi.fn(async (standings: LeaderboardStanding[]) =>
    standings.map((s) => ({ ...s, pseudo: `p-${s.userId}`, country: null })),
  );
  const broadcaster = new LeaderboardBroadcaster(INTERVAL_MS, {
    hub: { broadcast, send, allClients: () => clients },
    tracker,
    attachProfiles,
    limit,
  });
  return { broadcaster, broadcast, send, attachProfiles };
}

describe("LeaderboardBroadcaster", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("publishes the first dirty contributor of a quiet window right away", async () => {
    const tracker = new LeaderboardTracker(10);
    tracker.recordDrop("u1", [0, 1]);
    const { broadcaster, broadcast } = makeBroadcaster(tracker, 10);

    broadcaster.markDirty("u1");
    await vi.advanceTimersByTimeAsync(0);

    expect(broadcast).toHaveBeenCalledWith({
      t: "leaderboard_delta",
      entries: [{ userId: "u1", pieces: 2, pseudo: "p-u1", country: null }],
    });
  });

  it("coalesces every merge of a window into one delta carrying each mover once", async () => {
    const tracker = new LeaderboardTracker(10);
    const { broadcaster, broadcast } = makeBroadcaster(tracker, 10);

    tracker.recordDrop("u1", [0]);
    broadcaster.markDirty("u1");
    await vi.advanceTimersByTimeAsync(0);
    expect(broadcast).toHaveBeenCalledTimes(1);

    // Three more merges inside the same window: one publish, not three.
    tracker.recordDrop("u1", [1]);
    broadcaster.markDirty("u1");
    tracker.recordDrop("u2", [2, 3]);
    broadcaster.markDirty("u2");
    tracker.recordDrop("u1", [4]);
    broadcaster.markDirty("u1");
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast.mock.calls[1]![0]).toEqual({
      t: "leaderboard_delta",
      entries: [
        { userId: "u1", pieces: 3, pseudo: "p-u1", country: null },
        { userId: "u2", pieces: 2, pseudo: "p-u2", country: null },
      ],
    });
  });

  it("leaves out the entries that did not move", async () => {
    const tracker = new LeaderboardTracker(10);
    tracker.recordDrop("u1", [0, 1, 2]);
    tracker.recordDrop("u2", [3]);
    const { broadcaster, broadcast } = makeBroadcaster(tracker, 10);

    broadcaster.markDirty("u2");
    await vi.advanceTimersByTimeAsync(0);

    expect(broadcast).toHaveBeenCalledWith({
      t: "leaderboard_delta",
      entries: [{ userId: "u2", pieces: 1, pseudo: "p-u2", country: null }],
    });
  });

  it("sends a contributor ranked outside the top N their own standing instead", async () => {
    const tracker = new LeaderboardTracker(10);
    tracker.recordDrop("leader", [0, 1, 2]);
    tracker.recordDrop("tail", [3]);
    const { broadcaster, broadcast, send } = makeBroadcaster(tracker, 1, ["tail"]);

    broadcaster.markDirty("tail");
    await vi.advanceTimersByTimeAsync(0);

    // No row of theirs is inside the broadcast top N, so nothing goes global.
    expect(broadcast).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ userId: "tail" }), {
      t: "standing",
      pieces: 1,
      rank: 2,
    });
  });

  it("sends no personal standing to a contributor already carried by the delta", async () => {
    const tracker = new LeaderboardTracker(10);
    tracker.recordDrop("u1", [0]);
    const { broadcaster, broadcast, send } = makeBroadcaster(tracker, 10, ["u1"]);

    broadcaster.markDirty("u1");
    await vi.advanceTimersByTimeAsync(0);

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("broadcasts the full list on a snapshot, for a fold no delta can express", async () => {
    const tracker = new LeaderboardTracker(10);
    tracker.recordDrop("guest", [0, 1]);
    tracker.recordDrop("account", [2]);
    tracker.reassign("guest", "account");
    const { broadcaster, broadcast } = makeBroadcaster(tracker, 10);

    await broadcaster.broadcastSnapshot();

    expect(broadcast).toHaveBeenCalledWith({
      t: "leaderboard",
      entries: [{ userId: "account", pieces: 3, pseudo: "p-account", country: null }],
    });
  });

  it("stops publishing once stopped", async () => {
    const tracker = new LeaderboardTracker(10);
    tracker.recordDrop("u1", [0]);
    const { broadcaster, broadcast } = makeBroadcaster(tracker, 10);

    broadcaster.markDirty("u1");
    broadcaster.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);

    expect(broadcast).not.toHaveBeenCalled();
  });
});
