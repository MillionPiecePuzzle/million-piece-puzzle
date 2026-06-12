import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import {
  makeProfilePseudoHandler,
  makeProfileCountryHandler,
  makeCors,
  makeRateLimit,
  makeSpectatorGuard,
  makeLandingHandler,
  makeInterestedHandler,
  type InterestedStore,
  type LandingSnapshot,
} from "./httpApp.js";
import type { LandingResponse } from "@mpp/shared";
import { DuplicatePseudoError, type UserProfile } from "./mongo.js";
import { RedisFixedWindow } from "./limits.js";
import type { Redis } from "ioredis";

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    ended: false,
    headers: {} as Record<string, string>,
  };
  const r = res as unknown as Response & typeof res;
  r.status = vi.fn((code: number) => {
    res.statusCode = code;
    return r;
  }) as unknown as Response["status"];
  r.json = vi.fn((b: unknown) => {
    res.body = b;
    return r;
  }) as unknown as Response["json"];
  r.type = vi.fn(() => r) as unknown as Response["type"];
  r.send = vi.fn((b: unknown) => {
    res.body = b;
    return r;
  }) as unknown as Response["send"];
  r.end = vi.fn(() => {
    res.ended = true;
    return r;
  }) as unknown as Response["end"];
  r.setHeader = vi.fn((k: string, v: string) => {
    res.headers[k] = v;
    return r;
  }) as unknown as Response["setHeader"];
  r.set = vi.fn((h: Record<string, string>) => {
    Object.assign(res.headers, h);
    return r;
  }) as unknown as Response["set"];
  return r;
}

const profile: UserProfile = { id: "u1", name: "N", image: null, pseudo: "Alice", country: "fr" };

describe("makeProfilePseudoHandler", () => {
  it("401 when no session user", async () => {
    const setPseudo = vi.fn();
    const handler = makeProfilePseudoHandler({
      getUserId: async () => null,
      pseudoStore: { setPseudo },
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "Alice" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    expect(setPseudo).not.toHaveBeenCalled();
  });

  it("400 when the pseudo is invalid", async () => {
    const setPseudo = vi.fn();
    const handler = makeProfilePseudoHandler({
      getUserId: async () => "u1",
      pseudoStore: { setPseudo },
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "x" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(setPseudo).not.toHaveBeenCalled();
  });

  it("200 with the updated profile on success", async () => {
    const setPseudo = vi.fn(async () => profile);
    const handler = makeProfilePseudoHandler({
      getUserId: async () => "u1",
      pseudoStore: { setPseudo },
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "  Alice  " } } as Request, res);
    expect(setPseudo).toHaveBeenCalledWith("u1", "Alice");
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
    expect((res as unknown as { body: unknown }).body).toEqual({ user: profile });
  });

  it("409 when the pseudo is taken", async () => {
    const handler = makeProfilePseudoHandler({
      getUserId: async () => "u1",
      pseudoStore: {
        setPseudo: async () => {
          throw new DuplicatePseudoError();
        },
      },
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "Alice" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(409);
  });

  it("500 on an unexpected store error", async () => {
    const handler = makeProfilePseudoHandler({
      getUserId: async () => "u1",
      pseudoStore: {
        setPseudo: async () => {
          throw new Error("boom");
        },
      },
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "Alice" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(500);
  });
});

describe("makeProfileCountryHandler", () => {
  it("401 when no session user", async () => {
    const setCountry = vi.fn();
    const handler = makeProfileCountryHandler({
      getUserId: async () => null,
      countryStore: { setCountry },
    });
    const res = fakeRes();
    await handler({ body: { country: "fr" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    expect(setCountry).not.toHaveBeenCalled();
  });

  it("400 when the country is invalid", async () => {
    const setCountry = vi.fn();
    const handler = makeProfileCountryHandler({
      getUserId: async () => "u1",
      countryStore: { setCountry },
    });
    const res = fakeRes();
    await handler({ body: { country: "zz" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(setCountry).not.toHaveBeenCalled();
  });

  it("200 with the updated profile, normalizing the code", async () => {
    const setCountry = vi.fn(async () => profile);
    const handler = makeProfileCountryHandler({
      getUserId: async () => "u1",
      countryStore: { setCountry },
    });
    const res = fakeRes();
    await handler({ body: { country: "FR" } } as Request, res);
    expect(setCountry).toHaveBeenCalledWith("u1", "fr");
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
    expect((res as unknown as { body: unknown }).body).toEqual({ user: profile });
  });

  it("500 on an unexpected store error", async () => {
    const handler = makeProfileCountryHandler({
      getUserId: async () => "u1",
      countryStore: {
        setCountry: async () => {
          throw new Error("boom");
        },
      },
    });
    const res = fakeRes();
    await handler({ body: { country: "fr" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(500);
  });
});

describe("makeCors", () => {
  it("echoes the app origin with credentials and continues", () => {
    const cors = makeCors("http://app.test");
    const res = fakeRes();
    const next = vi.fn();
    cors({ headers: { origin: "http://app.test" }, method: "GET" } as Request, res, next);
    const headers = (res as unknown as { headers: Record<string, string> }).headers;
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://app.test");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(next).toHaveBeenCalled();
  });

  it("answers a preflight OPTIONS with 204 and does not continue", () => {
    const cors = makeCors("http://app.test");
    const res = fakeRes();
    const next = vi.fn();
    cors({ headers: { origin: "http://app.test" }, method: "OPTIONS" } as Request, res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("sends no CORS headers for a foreign origin", () => {
    const cors = makeCors("http://app.test");
    const res = fakeRes();
    const next = vi.fn();
    cors({ headers: { origin: "http://evil.test" }, method: "GET" } as Request, res, next);
    const headers = (res as unknown as { headers: Record<string, string> }).headers;
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

function fakeRedisAllowing(allow: boolean) {
  const incr = vi.fn(async () => (allow ? 1 : 999));
  const expire = vi.fn(async () => 1);
  return { incr, expire } as unknown as Redis;
}

describe("makeRateLimit", () => {
  it("continues when under budget", async () => {
    const mw = makeRateLimit(new RedisFixedWindow(fakeRedisAllowing(true), "auth", 60, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await mw({ headers: {}, socket: { remoteAddress: "1.1.1.1" } } as Request, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("429s when over budget", async () => {
    const mw = makeRateLimit(new RedisFixedWindow(fakeRedisAllowing(false), "auth", 60, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await mw({ headers: {}, socket: { remoteAddress: "1.1.1.1" } } as Request, res, next);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(429);
    expect(next).not.toHaveBeenCalled();
  });

  it("fails open when Redis errors", async () => {
    const redis = {
      incr: vi.fn(async () => {
        throw new Error("redis down");
      }),
      expire: vi.fn(),
    } as unknown as Redis;
    const mw = makeRateLimit(new RedisFixedWindow(redis, "auth", 60, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await mw({ headers: {}, socket: { remoteAddress: "1.1.1.1" } } as Request, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("makeSpectatorGuard", () => {
  function spectatorReq(over: Partial<Request> = {}): Request {
    return {
      method: "GET",
      headers: {},
      socket: { remoteAddress: "1.1.1.1" },
      query: {},
      ...over,
    } as unknown as Request;
  }

  it("lets a clean request under budget through", async () => {
    const guard = makeSpectatorGuard(
      new RedisFixedWindow(fakeRedisAllowing(true), "spectator", 120, 60),
      true,
    );
    const res = fakeRes();
    const next = vi.fn();
    await guard(spectatorReq(), res, next);
    expect(next).toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(0);
  });

  it("passes a preflight through without consuming the budget", async () => {
    const redis = fakeRedisAllowing(true);
    const guard = makeSpectatorGuard(new RedisFixedWindow(redis, "spectator", 120, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await guard(spectatorReq({ method: "OPTIONS" }), res, next);
    expect(next).toHaveBeenCalled();
    expect((redis as unknown as { incr: ReturnType<typeof vi.fn> }).incr).not.toHaveBeenCalled();
  });

  it("429s a request over budget with wildcard CORS and no-store", async () => {
    const guard = makeSpectatorGuard(
      new RedisFixedWindow(fakeRedisAllowing(false), "spectator", 120, 60),
      true,
    );
    const res = fakeRes();
    const next = vi.fn();
    await guard(spectatorReq(), res, next);
    const r = res as unknown as { statusCode: number; headers: Record<string, string> };
    expect(r.statusCode).toBe(429);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(next).not.toHaveBeenCalled();
  });

  it("400s a cache-busting query string after counting it against the budget", async () => {
    const redis = fakeRedisAllowing(true);
    const guard = makeSpectatorGuard(new RedisFixedWindow(redis, "spectator", 120, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await guard(spectatorReq({ query: { cb: "1" } as unknown as Request["query"] }), res, next);
    const r = res as unknown as { statusCode: number; headers: Record<string, string> };
    expect(r.statusCode).toBe(400);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect((redis as unknown as { incr: ReturnType<typeof vi.fn> }).incr).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("fails open when Redis errors", async () => {
    const redis = {
      incr: vi.fn(async () => {
        throw new Error("redis down");
      }),
      expire: vi.fn(),
    } as unknown as Redis;
    const guard = makeSpectatorGuard(new RedisFixedWindow(redis, "spectator", 120, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await guard(spectatorReq(), res, next);
    expect(next).toHaveBeenCalled();
  });
});

function landingReq(): Request {
  return { headers: {}, socket: { remoteAddress: "1.1.1.1" } } as unknown as Request;
}

function fakeSnapshot(): LandingSnapshot {
  return {
    lockedCount: 120,
    totalPieces: 1000,
    leaderboard: [{ userId: "u1", pseudo: "Alice", country: "fr", pieces: 80 }],
    activity: [
      {
        id: "m1",
        userId: "u1",
        pseudo: "Alice",
        anchored: true,
        droppedSize: 1,
        mergedSize: 2,
        at: 5,
      },
    ],
  };
}

describe("makeLandingHandler", () => {
  it("returns the event start, interested, and live snapshot, skipping the span when active", async () => {
    const interested: InterestedStore = {
      add: vi.fn(),
      status: vi.fn(async () => ({ count: 7, me: true })),
    };
    const span = vi.fn(async () => null);
    const handler = makeLandingHandler({
      interested,
      eventStartsAt: 12345,
      snapshot: () => fakeSnapshot(),
      status: () => "active",
      span,
      devEnabled: true,
    });
    const res = fakeRes();
    await handler(landingReq(), res);
    const r = res as unknown as {
      statusCode: number;
      body: LandingResponse;
      headers: Record<string, string>;
    };
    expect(r.statusCode).toBe(200);
    expect(r.body.eventStartsAt).toBe(12345);
    expect(r.body.interested).toEqual({ count: 7, me: true });
    expect(r.body.status).toBe("active");
    expect(r.body.progress).toEqual({ locked: 120, total: 1000 });
    expect(r.body.leaderboard).toHaveLength(1);
    expect(r.body.activity).toHaveLength(1);
    expect(r.body.completion).toBeUndefined();
    expect(span).not.toHaveBeenCalled();
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  it("includes the completion span once completed", async () => {
    const interested: InterestedStore = {
      add: vi.fn(),
      status: vi.fn(async () => ({ count: 0, me: false })),
    };
    const span = vi.fn(async () => ({ firstAt: 100, lastAt: 900 }));
    const handler = makeLandingHandler({
      interested,
      eventStartsAt: 50,
      snapshot: () => fakeSnapshot(),
      status: () => "completed",
      span,
      devEnabled: true,
    });
    const res = fakeRes();
    await handler(landingReq(), res);
    const r = res as unknown as { statusCode: number; body: LandingResponse };
    expect(span).toHaveBeenCalled();
    expect(r.body.status).toBe("completed");
    expect(r.body.completion).toEqual({ at: 900, startedAt: 100 });
  });

  it("fails open with a zeroed interested block and empty snapshot", async () => {
    const interested: InterestedStore = {
      add: vi.fn(),
      status: vi.fn(async () => {
        throw new Error("redis down");
      }),
    };
    const handler = makeLandingHandler({
      interested,
      eventStartsAt: 0,
      snapshot: () => null,
      status: () => "active",
      span: vi.fn(async () => null),
      devEnabled: true,
    });
    const res = fakeRes();
    await handler(landingReq(), res);
    const r = res as unknown as { statusCode: number; body: LandingResponse };
    expect(r.statusCode).toBe(200);
    expect(r.body.interested).toEqual({ count: 0, me: false });
    expect(r.body.progress).toEqual({ locked: 0, total: 0 });
    expect(r.body.leaderboard).toEqual([]);
    expect(r.body.activity).toEqual([]);
    expect(r.body.completion).toBeUndefined();
  });
});

describe("makeInterestedHandler", () => {
  it("registers the IP and returns the count with me=true", async () => {
    const interested: InterestedStore = {
      add: vi.fn(async () => ({ count: 3, me: true })),
      status: vi.fn(),
    };
    const handler = makeInterestedHandler({ interested, devEnabled: true });
    const res = fakeRes();
    await handler(landingReq(), res);
    const r = res as unknown as {
      statusCode: number;
      body: unknown;
      headers: Record<string, string>;
    };
    expect(interested.add).toHaveBeenCalledWith("1.1.1.1");
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ count: 3, me: true });
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(r.headers["Cache-Control"]).toBe("no-store");
  });

  it("fails open with an optimistic me=true when the store throws", async () => {
    const interested: InterestedStore = {
      add: vi.fn(async () => {
        throw new Error("redis down");
      }),
      status: vi.fn(),
    };
    const handler = makeInterestedHandler({ interested, devEnabled: true });
    const res = fakeRes();
    await handler(landingReq(), res);
    const r = res as unknown as { statusCode: number; body: unknown };
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ count: 0, me: true });
  });
});
