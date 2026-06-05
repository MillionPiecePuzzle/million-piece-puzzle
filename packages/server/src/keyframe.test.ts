import { describe, it, expect, vi } from "vitest";
import {
  SPECTATOR_FORMAT_VERSION,
  type ActivityItem,
  type GroupRuntime,
  type LeaderboardEntry,
  type PieceRuntime,
  type PlayZone,
} from "@mpp/shared";
import type { RedisState } from "./state.js";
import type { EventLog } from "./eventLog.js";
import {
  KeyframePublisher,
  buildKeyframe,
  makeEventsHandler,
  makeKeyframeHandler,
  type KeyframeSource,
} from "./keyframe.js";

const pieces: PieceRuntime[] = [
  { id: 0, groupId: 0, rotation: 0 },
  { id: 1, groupId: 1, rotation: 0 },
];
const groups: GroupRuntime[] = [
  { id: 0, worldX: 0, worldY: 0, size: 1, locked: true, heldBy: null },
  { id: 1, worldX: 80, worldY: 0, size: 1, locked: false, heldBy: null },
];
const leaderboardEntries: LeaderboardEntry[] = [{ userId: "u1", pieces: 3 }];
const activityItems: ActivityItem[] = [{ id: "m1", userId: "u1", lockedDelta: 2, at: 1000 }];
const zone: PlayZone = { minX: -100, minY: -100, maxX: 900, maxY: 900 };

type SourceOpts = {
  status?: "active" | "completed";
  eventStartsAt?: number;
  head?: () => Promise<string>;
  readAllPieces?: () => Promise<PieceRuntime[]>;
};

function makeSource(opts: SourceOpts = {}): KeyframeSource {
  const state = {
    readAllPieces: opts.readAllPieces ?? (async () => pieces),
    readAllGroups: async () => groups,
    getLockedCount: async () => 1,
  };
  const eventLog = { head: opts.head ?? (async () => "7-0") };
  return {
    state: state as unknown as RedisState,
    eventLog: eventLog as unknown as EventLog,
    puzzleId: () => "puzzle-1",
    totalPieces: () => 2,
    playZone: () => zone,
    eventStartsAt: () => opts.eventStartsAt ?? 0,
    status: () => opts.status ?? "active",
    leaderboard: async () => leaderboardEntries,
    activity: async () => activityItems,
    windowMs: 3000,
    delayMs: 6000,
  };
}

function fakeResponse() {
  let status = 0;
  let headers: Record<string, string | number> = {};
  let body: string | undefined;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });
  return {
    writeHead(s: number, h: Record<string, string | number>) {
      status = s;
      headers = h;
    },
    end(b?: string) {
      body = b;
      resolveDone();
    },
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
    get body() {
      return body;
    },
    done,
  };
}

describe("buildKeyframe", () => {
  it("collects board state, standings, the cursor, and stream parameters", async () => {
    const before = Date.now();
    const kf = await buildKeyframe(makeSource(), true);
    expect(kf.v).toBe(SPECTATOR_FORMAT_VERSION);
    expect(kf.puzzleId).toBe("puzzle-1");
    expect(kf.cursor).toBe("7-0");
    expect(kf.windowMs).toBe(3000);
    expect(kf.delayMs).toBe(6000);
    expect(kf.live).toBe(true);
    expect(kf.lockedCount).toBe(1);
    expect(kf.totalPieces).toBe(2);
    expect(kf.pieces).toHaveLength(2);
    expect(kf.groups).toHaveLength(2);
    expect(kf.playZone).toEqual(zone);
    expect(kf.eventStartsAt).toBe(0);
    expect(kf.leaderboard).toEqual(leaderboardEntries);
    expect(kf.activity).toEqual(activityItems);
    expect(kf.generatedAt).toBeGreaterThanOrEqual(before);
    expect(kf.generatedAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("KeyframePublisher idle gate", () => {
  it("builds once at boot, then skips while idle until forced", async () => {
    let reads = 0;
    const source = makeSource({
      status: "completed",
      readAllPieces: async () => {
        reads++;
        return pieces;
      },
    });
    const pub = new KeyframePublisher(300000, source);
    await pub.regenerate();
    expect(reads).toBe(1);
    expect(pub.latest()).not.toBeNull();
    // Idle and a body exists, so a normal tick reads nothing.
    await pub.regenerate();
    expect(reads).toBe(1);
    // Forced (reset/complete transition) bypasses the gate.
    await pub.regenerate(true);
    expect(reads).toBe(2);
    expect(pub.latest()!.keyframe.live).toBe(false);
  });

  it("regenerates on every tick while live", async () => {
    let reads = 0;
    const source = makeSource({
      status: "active",
      readAllPieces: async () => {
        reads++;
        return pieces;
      },
    });
    const pub = new KeyframePublisher(300000, source);
    await pub.regenerate();
    await pub.regenerate();
    expect(reads).toBe(2);
  });

  it("keeps the previous body when a regeneration throws", async () => {
    let calls = 0;
    const source = makeSource({
      readAllPieces: async () => {
        calls++;
        if (calls === 2) throw new Error("redis down");
        return pieces;
      },
    });
    const pub = new KeyframePublisher(300000, source);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await pub.regenerate();
    const first = pub.latest();
    expect(first).not.toBeNull();
    await pub.regenerate();
    expect(pub.latest()?.body).toBe(first?.body);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("makeKeyframeHandler", () => {
  const opts = { intervalMs: 300000, idleTtlMs: 15000 };

  it("returns 503 before the first keyframe is ready", () => {
    const pub = new KeyframePublisher(300000, makeSource());
    const handle = makeKeyframeHandler(pub, opts);
    const res = fakeResponse();
    const handled = handle({ url: "/keyframe", method: "GET" } as never, res as never);
    expect(handled).toBe(true);
    expect(res.status).toBe(503);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("serves a long max-age while live", async () => {
    const pub = new KeyframePublisher(300000, makeSource({ status: "active" }));
    await pub.regenerate();
    const handle = makeKeyframeHandler(pub, opts);
    const res = fakeResponse();
    handle({ url: "/keyframe", method: "GET" } as never, res as never);
    expect(res.status).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("public, max-age=300");
    expect(JSON.parse(res.body!).puzzleId).toBe("puzzle-1");
  });

  it("serves a short max-age while idle so a transition is picked up promptly", async () => {
    const pub = new KeyframePublisher(300000, makeSource({ status: "completed" }));
    await pub.regenerate();
    const handle = makeKeyframeHandler(pub, opts);
    const res = fakeResponse();
    handle({ url: "/keyframe", method: "GET" } as never, res as never);
    expect(res.status).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("public, max-age=15");
  });

  it("answers HEAD without a body and rejects non-GET/HEAD", async () => {
    const pub = new KeyframePublisher(300000, makeSource());
    await pub.regenerate();
    const handle = makeKeyframeHandler(pub, opts);
    const head = fakeResponse();
    handle({ url: "/keyframe", method: "HEAD" } as never, head as never);
    expect(head.status).toBe(200);
    expect(head.body).toBeUndefined();
    const post = fakeResponse();
    handle({ url: "/keyframe", method: "POST" } as never, post as never);
    expect(post.status).toBe(405);
  });

  it("ignores other paths and keeps query strings on /keyframe", async () => {
    const pub = new KeyframePublisher(300000, makeSource());
    await pub.regenerate();
    const handle = makeKeyframeHandler(pub, opts);
    const other = fakeResponse();
    expect(handle({ url: "/other", method: "GET" } as never, other as never)).toBe(false);
    expect(other.status).toBe(0);
    const qs = fakeResponse();
    handle({ url: "/keyframe?cb=1", method: "GET" } as never, qs as never);
    expect(qs.status).toBe(200);
  });

  it("always sets wildcard CORS and answers OPTIONS", async () => {
    const pub = new KeyframePublisher(300000, makeSource());
    await pub.regenerate();
    const handle = makeKeyframeHandler(pub, opts);
    const get = fakeResponse();
    handle(
      { url: "/keyframe", method: "GET", headers: { origin: "https://x.example" } } as never,
      get as never,
    );
    expect(get.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(get.headers["Vary"]).toBeUndefined();
    const opt = fakeResponse();
    handle({ url: "/keyframe", method: "OPTIONS" } as never, opt as never);
    expect(opt.status).toBe(204);
    expect(opt.headers["Access-Control-Allow-Methods"]).toMatch(/GET/);
  });
});

describe("makeEventsHandler", () => {
  const windowEvents = [
    { k: "drop" as const, seq: "3000-0", at: 3000, groupId: 1, worldX: 10, worldY: 20 },
  ];
  function handlerWithNow(now: number) {
    const eventLog = { readWindow: async () => windowEvents } as unknown as EventLog;
    return makeEventsHandler({ eventLog, windowMs: 3000, retentionMs: 900000, now: () => now });
  }

  it("rejects a non-W-aligned t0 with 400 no-store", () => {
    const res = fakeResponse();
    handlerWithNow(100000)({ url: "/events/1000", method: "GET" } as never, res as never);
    expect(res.status).toBe(400);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("rejects a not-yet-sealed window with 425 no-store", () => {
    const res = fakeResponse();
    handlerWithNow(4000)({ url: "/events/3000", method: "GET" } as never, res as never);
    expect(res.status).toBe(425);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("rejects an out-of-retention window with 404 no-store", () => {
    const res = fakeResponse();
    handlerWithNow(2_000_000)({ url: "/events/0", method: "GET" } as never, res as never);
    expect(res.status).toBe(404);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("serves a sealed window as an immutable body", async () => {
    const res = fakeResponse();
    const handled = handlerWithNow(10000)(
      { url: "/events/3000", method: "GET" } as never,
      res as never,
    );
    expect(handled).toBe(true);
    await res.done;
    expect(res.status).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    const body = JSON.parse(res.body!);
    expect(body.v).toBe(SPECTATOR_FORMAT_VERSION);
    expect(body.t0).toBe(3000);
    expect(body.windowMs).toBe(3000);
    expect(body.events).toHaveLength(1);
  });

  it("ignores paths outside /events/", () => {
    const res = fakeResponse();
    expect(handlerWithNow(10000)({ url: "/keyframe", method: "GET" } as never, res as never)).toBe(
      false,
    );
  });
});
