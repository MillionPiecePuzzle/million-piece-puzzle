import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GroupRuntime, PieceRuntime, PlayZone } from "@mpp/shared";
import {
  SnapshotPublisher,
  buildSnapshot,
  makeSnapshotHandler,
  type SnapshotSource,
} from "./snapshot.js";

type FakeState = {
  readAllPieces: (n: number) => Promise<PieceRuntime[]>;
  readAllGroups: (n: number) => Promise<GroupRuntime[]>;
  getLockedCount: () => Promise<number>;
};

const zone: PlayZone = { minX: -100, minY: -100, maxX: 900, maxY: 900 };

function makeSource(overrides: Partial<FakeState> = {}): SnapshotSource {
  const pieces: PieceRuntime[] = [
    { id: 0, groupId: 0, rotation: 0 },
    { id: 1, groupId: 1, rotation: 0 },
  ];
  const groups: GroupRuntime[] = [
    { id: 0, worldX: 0, worldY: 0, size: 1, locked: true, heldBy: null },
    { id: 1, worldX: 80, worldY: 0, size: 1, locked: false, heldBy: null },
  ];
  const state: FakeState = {
    readAllPieces: async () => pieces,
    readAllGroups: async () => groups,
    getLockedCount: async () => 1,
    ...overrides,
  };
  return {
    puzzleId: () => "puzzle-1",
    totalPieces: () => 2,
    playZone: () => zone,
    state: state as unknown as SnapshotSource["state"],
  };
}

function fakeResponse() {
  let status = 0;
  let headers: Record<string, string | number> = {};
  let body: string | undefined;
  return {
    writeHead(s: number, h: Record<string, string | number>) {
      status = s;
      headers = h;
    },
    end(b?: string) {
      body = b;
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
  };
}

describe("buildSnapshot", () => {
  it("collects pieces, groups, lockedCount, playZone and a timestamp", async () => {
    const before = Date.now();
    const snap = await buildSnapshot(makeSource());
    expect(snap.puzzleId).toBe("puzzle-1");
    expect(snap.totalPieces).toBe(2);
    expect(snap.lockedCount).toBe(1);
    expect(snap.pieces).toHaveLength(2);
    expect(snap.groups).toHaveLength(2);
    expect(snap.playZone).toEqual(zone);
    expect(snap.generatedAt).toBeGreaterThanOrEqual(before);
    expect(snap.generatedAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("SnapshotPublisher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has no latest body before the first regeneration completes", () => {
    const pub = new SnapshotPublisher(2000, makeSource());
    expect(pub.latest()).toBeNull();
  });

  it("caches the last successful body across regenerations", async () => {
    const pub = new SnapshotPublisher(2000, makeSource());
    pub.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = pub.latest();
    expect(first).not.toBeNull();
    expect(JSON.parse(first!.body).puzzleId).toBe("puzzle-1");
    pub.stop();
  });

  it("keeps the previous snapshot when a regeneration throws", async () => {
    let calls = 0;
    const source = makeSource({
      readAllPieces: async () => {
        calls++;
        if (calls === 2) throw new Error("redis down");
        return [];
      },
    });
    const pub = new SnapshotPublisher(2000, source);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    pub.start();
    await vi.advanceTimersByTimeAsync(0);
    const first = pub.latest();
    expect(first).not.toBeNull();
    await pub.regenerate();
    const second = pub.latest();
    expect(second?.body).toBe(first?.body);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    pub.stop();
  });
});

describe("makeSnapshotHandler", () => {
  it("returns 503 before the first snapshot is ready", () => {
    const pub = new SnapshotPublisher(2000, makeSource());
    const handle = makeSnapshotHandler(pub, 2000);
    const res = fakeResponse();
    const handled = handle({ url: "/snapshot", method: "GET" } as never, res as never);
    expect(handled).toBe(true);
    expect(res.status).toBe(503);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("returns 200 with the cached body and a cache-control matching the interval", async () => {
    const pub = new SnapshotPublisher(3000, makeSource());
    await pub.regenerate();
    const handle = makeSnapshotHandler(pub, 3000);
    const res = fakeResponse();
    handle({ url: "/snapshot", method: "GET" } as never, res as never);
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toMatch(/application\/json/);
    expect(res.headers["Cache-Control"]).toBe("public, max-age=3");
    expect(JSON.parse(res.body!).puzzleId).toBe("puzzle-1");
  });

  it("answers HEAD without a body", async () => {
    const pub = new SnapshotPublisher(2000, makeSource());
    await pub.regenerate();
    const handle = makeSnapshotHandler(pub, 2000);
    const res = fakeResponse();
    handle({ url: "/snapshot", method: "HEAD" } as never, res as never);
    expect(res.status).toBe(200);
    expect(res.body).toBeUndefined();
  });

  it("rejects non-GET/HEAD with 405", () => {
    const pub = new SnapshotPublisher(2000, makeSource());
    const handle = makeSnapshotHandler(pub, 2000);
    const res = fakeResponse();
    handle({ url: "/snapshot", method: "POST" } as never, res as never);
    expect(res.status).toBe(405);
    expect(res.headers["Allow"]).toBe("GET, HEAD");
  });

  it("ignores other paths so the caller can fall through to a 404", () => {
    const pub = new SnapshotPublisher(2000, makeSource());
    const handle = makeSnapshotHandler(pub, 2000);
    const res = fakeResponse();
    const handled = handle({ url: "/other", method: "GET" } as never, res as never);
    expect(handled).toBe(false);
    expect(res.status).toBe(0);
  });

  it("ignores query strings on /snapshot", async () => {
    const pub = new SnapshotPublisher(2000, makeSource());
    await pub.regenerate();
    const handle = makeSnapshotHandler(pub, 2000);
    const res = fakeResponse();
    handle({ url: "/snapshot?cb=12345", method: "GET" } as never, res as never);
    expect(res.status).toBe(200);
  });
});
