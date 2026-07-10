import { describe, it, expect, vi } from "vitest";
import express, { type Request, type Response } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AdmissionController } from "./admission.js";
import {
  makeProfilePseudoHandler,
  makeProfileCountryHandler,
  makeGuestHandler,
  makeClaimHandler,
  makeCors,
  makeRateLimit,
  makePublicGuard,
  makeLandingHandler,
  makeInterestedHandler,
  makeQueueGuard,
  makeQueueTicketHandler,
  makeQueueStatusHandler,
  type GuestStore,
  type GuestSessionMinter,
  type InterestedStore,
  type LandingSnapshot,
  type AdmissionGate,
} from "./httpApp.js";
import type { LandingResponse } from "@mpp/shared";
import { hashClaimToken } from "./auth.js";
import {
  CountryCooldownError,
  DuplicatePseudoError,
  PseudoCooldownError,
  type UserProfile,
} from "./mongo.js";
import { RedisFixedWindow } from "./limits.js";
import type { Redis } from "ioredis";

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    ended: false,
    headers: {} as Record<string, string>,
    cookies: [] as { name: string; value: string; options: Record<string, unknown> }[],
  };
  const r = res as unknown as Response & typeof res;
  r.cookie = vi.fn((name: string, value: string, options: Record<string, unknown>) => {
    res.cookies.push({ name, value, options });
    return r;
  }) as unknown as Response["cookie"];
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

const profile: UserProfile = {
  id: "u1",
  guest: false,
  name: "N",
  image: null,
  pseudo: "Alice",
  country: "fr",
};

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

  it("429 with retryAt when the pseudo change is on cooldown", async () => {
    const retryAt = new Date("2026-07-03T00:00:00.000Z");
    const handler = makeProfilePseudoHandler({
      getUserId: async () => "u1",
      pseudoStore: {
        setPseudo: async () => {
          throw new PseudoCooldownError(retryAt);
        },
      },
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "Alice" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(429);
    expect((res as unknown as { body: unknown }).body).toEqual({
      error: "pseudo_cooldown",
      retryAt: retryAt.getTime(),
    });
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

  it("200 for the international opt-out code", async () => {
    const setCountry = vi.fn(async () => profile);
    const handler = makeProfileCountryHandler({
      getUserId: async () => "u1",
      countryStore: { setCountry },
    });
    const res = fakeRes();
    await handler({ body: { country: "un" } } as Request, res);
    expect(setCountry).toHaveBeenCalledWith("u1", "un");
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
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

  it("429 with retryAt when the country change is on cooldown", async () => {
    const retryAt = new Date("2026-07-03T00:00:00.000Z");
    const handler = makeProfileCountryHandler({
      getUserId: async () => "u1",
      countryStore: {
        setCountry: async () => {
          throw new CountryCooldownError(retryAt);
        },
      },
    });
    const res = fakeRes();
    await handler({ body: { country: "fr" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(429);
    expect((res as unknown as { body: unknown }).body).toEqual({
      error: "country_cooldown",
      retryAt: retryAt.getTime(),
    });
  });
});

describe("makeGuestHandler", () => {
  const guestProfile: UserProfile = {
    id: "g1",
    guest: true,
    name: null,
    image: null,
    pseudo: "Alice",
    country: "fr",
  };
  const okStore = (): GuestStore => ({
    createGuest: vi.fn(
      async (_input: { pseudo: string; country: string; claimTokenHash: string }) => ({
        id: "g1",
        user: guestProfile,
      }),
    ),
  });
  const okMinter = (
    token = "sess-tok",
    expires = new Date(Date.now() + 1000),
  ): GuestSessionMinter => ({
    mint: vi.fn(async () => ({ token, expires })),
  });

  it("400 on an invalid pseudo, minting nothing", async () => {
    const store = okStore();
    const minter = okMinter();
    const handler = makeGuestHandler({
      guestStore: store,
      sessionMinter: minter,
      cookieName: "authjs.session-token",
      cookieSecure: false,
      cookieDomain: "",
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "x", country: "fr" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(store.createGuest).not.toHaveBeenCalled();
    expect(minter.mint).not.toHaveBeenCalled();
  });

  it("400 on an invalid country, minting nothing", async () => {
    const store = okStore();
    const handler = makeGuestHandler({
      guestStore: store,
      sessionMinter: okMinter(),
      cookieName: "authjs.session-token",
      cookieSecure: false,
      cookieDomain: "",
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "Alice", country: "zz" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(store.createGuest).not.toHaveBeenCalled();
  });

  it("201 mints the guest, stores the hash of the returned token, and sets the cookie", async () => {
    const store = okStore();
    const expires = new Date(Date.now() + 1000);
    const minter = okMinter("sess-tok", expires);
    const handler = makeGuestHandler({
      guestStore: store,
      sessionMinter: minter,
      cookieName: "__Secure-authjs.session-token",
      cookieSecure: true,
      cookieDomain: ".mpp.test",
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "  Alice  ", country: "FR" } } as Request, res);
    const r = res as unknown as {
      statusCode: number;
      body: { user: UserProfile; claimToken: string };
      cookies: { name: string; value: string; options: Record<string, unknown> }[];
    };
    expect(r.statusCode).toBe(201);
    const call = (store.createGuest as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      pseudo: string;
      country: string;
      claimTokenHash: string;
    };
    // pseudo trimmed/collapsed, country lowercased before minting.
    expect(call.pseudo).toBe("Alice");
    expect(call.country).toBe("fr");
    // The stored value is the sha256 of the token handed back, never the token itself.
    expect(call.claimTokenHash).toBe(hashClaimToken(r.body.claimToken));
    expect(call.claimTokenHash).not.toBe(r.body.claimToken);
    expect(minter.mint).toHaveBeenCalledWith("g1");
    expect(r.body.user).toEqual(guestProfile);
    expect(r.cookies).toHaveLength(1);
    expect(r.cookies[0]).toMatchObject({
      name: "__Secure-authjs.session-token",
      value: "sess-tok",
    });
    expect(r.cookies[0].options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      domain: ".mpp.test",
      expires,
    });
  });

  it("omits the cookie domain when host-only", async () => {
    const handler = makeGuestHandler({
      guestStore: okStore(),
      sessionMinter: okMinter("t", new Date()),
      cookieName: "authjs.session-token",
      cookieSecure: false,
      cookieDomain: "",
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "Alice", country: "fr" } } as Request, res);
    const r = res as unknown as { cookies: { options: Record<string, unknown> }[] };
    expect(r.cookies[0].options).not.toHaveProperty("domain");
    expect(r.cookies[0].options.secure).toBe(false);
  });

  it("409 when the pseudo is taken", async () => {
    const handler = makeGuestHandler({
      guestStore: {
        createGuest: async () => {
          throw new DuplicatePseudoError();
        },
      },
      sessionMinter: okMinter(),
      cookieName: "authjs.session-token",
      cookieSecure: false,
      cookieDomain: "",
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "Alice", country: "fr" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(409);
  });

  it("500 and no cookie when the session mint fails", async () => {
    const handler = makeGuestHandler({
      guestStore: okStore(),
      sessionMinter: {
        mint: async () => {
          throw new Error("boom");
        },
      },
      cookieName: "authjs.session-token",
      cookieSecure: false,
      cookieDomain: "",
    });
    const res = fakeRes();
    await handler({ body: { pseudo: "Alice", country: "fr" } } as Request, res);
    const r = res as unknown as { statusCode: number; cookies: unknown[] };
    expect(r.statusCode).toBe(500);
    expect(r.cookies).toHaveLength(0);
  });
});

describe("makeClaimHandler", () => {
  const claimedProfile: UserProfile = {
    id: "google1",
    guest: false,
    name: "G",
    image: null,
    pseudo: "Alice",
    country: "fr",
  };

  it("401 when no session user, claiming nothing", async () => {
    const claimGuest = vi.fn();
    const handler = makeClaimHandler({ getUserId: async () => null, claimStore: { claimGuest } });
    const res = fakeRes();
    await handler({ body: { claimToken: "tok" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    expect(claimGuest).not.toHaveBeenCalled();
  });

  it("400 when the claim token is missing, claiming nothing", async () => {
    const claimGuest = vi.fn();
    const handler = makeClaimHandler({
      getUserId: async () => "google1",
      claimStore: { claimGuest },
    });
    const res = fakeRes();
    await handler({ body: {} } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(claimGuest).not.toHaveBeenCalled();
  });

  it("404 when no claimable guest matches the token", async () => {
    const handler = makeClaimHandler({
      getUserId: async () => "google1",
      claimStore: { claimGuest: async () => ({ status: "not_found" as const }) },
    });
    const res = fakeRes();
    await handler({ body: { claimToken: "tok" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(404);
  });

  it("409 when the caller claims its own guest session", async () => {
    const handler = makeClaimHandler({
      getUserId: async () => "g1",
      claimStore: { claimGuest: async () => ({ status: "self" as const }) },
    });
    const res = fakeRes();
    await handler({ body: { claimToken: "tok" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(409);
  });

  it("200 reattributes by token hash and returns the updated profile", async () => {
    const claimGuest = vi.fn(async () => ({ status: "ok" as const, user: claimedProfile }));
    const handler = makeClaimHandler({
      getUserId: async () => "google1",
      claimStore: { claimGuest },
    });
    const res = fakeRes();
    await handler({ body: { claimToken: "raw-token" } } as Request, res);
    const r = res as unknown as { statusCode: number; body: { user: UserProfile } };
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ user: claimedProfile });
    // The handler hashes the token before it reaches the store; the raw token never does.
    expect(claimGuest).toHaveBeenCalledWith("google1", hashClaimToken("raw-token"));
    expect(claimGuest).not.toHaveBeenCalledWith("google1", "raw-token");
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

describe("makePublicGuard", () => {
  function publicReq(over: Partial<Request> = {}): Request {
    return {
      method: "GET",
      headers: {},
      socket: { remoteAddress: "1.1.1.1" },
      query: {},
      ...over,
    } as unknown as Request;
  }

  it("lets a clean request under budget through", async () => {
    const guard = makePublicGuard(
      new RedisFixedWindow(fakeRedisAllowing(true), "public", 120, 60),
      true,
    );
    const res = fakeRes();
    const next = vi.fn();
    await guard(publicReq(), res, next);
    expect(next).toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(0);
  });

  it("passes a preflight through without consuming the budget", async () => {
    const redis = fakeRedisAllowing(true);
    const guard = makePublicGuard(new RedisFixedWindow(redis, "public", 120, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await guard(publicReq({ method: "OPTIONS" }), res, next);
    expect(next).toHaveBeenCalled();
    expect((redis as unknown as { incr: ReturnType<typeof vi.fn> }).incr).not.toHaveBeenCalled();
  });

  it("429s a request over budget with wildcard CORS and no-store", async () => {
    const guard = makePublicGuard(
      new RedisFixedWindow(fakeRedisAllowing(false), "public", 120, 60),
      true,
    );
    const res = fakeRes();
    const next = vi.fn();
    await guard(publicReq(), res, next);
    const r = res as unknown as { statusCode: number; headers: Record<string, string> };
    expect(r.statusCode).toBe(429);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(next).not.toHaveBeenCalled();
  });

  it("400s a cache-busting query string after counting it against the budget", async () => {
    const redis = fakeRedisAllowing(true);
    const guard = makePublicGuard(new RedisFixedWindow(redis, "public", 120, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await guard(publicReq({ query: { cb: "1" } as unknown as Request["query"] }), res, next);
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
    const guard = makePublicGuard(new RedisFixedWindow(redis, "public", 120, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await guard(publicReq(), res, next);
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
      eventStartsAt: () => 12345,
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
      eventStartsAt: () => 50,
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
      eventStartsAt: () => 0,
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

describe("makeQueueGuard", () => {
  function queueReq(over: Partial<Request> = {}): Request {
    return {
      method: "GET",
      headers: {},
      socket: { remoteAddress: "1.1.1.1" },
      query: {},
      ...over,
    } as unknown as Request;
  }

  it("answers a preflight with 204 and wildcard CORS, without continuing", async () => {
    const guard = makeQueueGuard(
      new RedisFixedWindow(fakeRedisAllowing(true), "queue", 180, 60),
      true,
    );
    const res = fakeRes();
    const next = vi.fn();
    await guard(queueReq({ method: "OPTIONS" }), res, next);
    const r = res as unknown as { statusCode: number; headers: Record<string, string> };
    expect(r.statusCode).toBe(204);
    expect(r.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(next).not.toHaveBeenCalled();
  });

  it("lets a request under budget through with a ticket query preserved", async () => {
    const guard = makeQueueGuard(
      new RedisFixedWindow(fakeRedisAllowing(true), "queue", 180, 60),
      true,
    );
    const res = fakeRes();
    const next = vi.fn();
    await guard(queueReq({ query: { ticket: "t1" } as Request["query"] }), res, next);
    expect(next).toHaveBeenCalled();
    expect((res as unknown as { headers: Record<string, string> }).headers["Cache-Control"]).toBe(
      "no-store",
    );
  });

  it("429s when over budget", async () => {
    const guard = makeQueueGuard(
      new RedisFixedWindow(fakeRedisAllowing(false), "queue", 180, 60),
      true,
    );
    const res = fakeRes();
    const next = vi.fn();
    await guard(queueReq(), res, next);
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
    const guard = makeQueueGuard(new RedisFixedWindow(redis, "queue", 180, 60), true);
    const res = fakeRes();
    const next = vi.fn();
    await guard(queueReq(), res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("makeQueueTicketHandler / makeQueueStatusHandler", () => {
  const gate: AdmissionGate = {
    requestTicket: () => ({ state: "ready", ticket: "t1", grant: "g1" }),
    status: (id: string) =>
      id === "t1" ? { state: "queued", ticket: "t1", position: 3 } : { state: "expired" },
  };

  it("returns the controller's ticket result as JSON", () => {
    const handler = makeQueueTicketHandler({ admission: gate });
    const res = fakeRes();
    handler({} as Request, res);
    const r = res as unknown as { statusCode: number; body: unknown };
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ state: "ready", ticket: "t1", grant: "g1" });
  });

  it("400s a status poll with no ticket param", () => {
    const handler = makeQueueStatusHandler({ admission: gate });
    const res = fakeRes();
    handler({ query: {} } as unknown as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
  });

  it("returns the controller's status result for a known ticket", () => {
    const handler = makeQueueStatusHandler({ admission: gate });
    const res = fakeRes();
    handler({ query: { ticket: "t1" } } as unknown as Request, res);
    const r = res as unknown as { statusCode: number; body: unknown };
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ state: "queued", ticket: "t1", position: 3 });
  });
});

// Drives the queue routes through a real Express app over a live socket, backed by
// a real AdmissionController, so the route paths, the guard, query parsing and the
// JSON round-trip are exercised together (the handler tests above stub the gate).
describe("queue endpoints over HTTP", () => {
  async function withApp(cap: number, run: (base: string) => Promise<void>): Promise<void> {
    const admission = new AdmissionController({
      cap,
      grantTtlMs: 10_000,
      ticketTtlMs: 15_000,
      maxQueueLength: 100,
    });
    const app = express();
    const limiter = new RedisFixedWindow(fakeRedisAllowing(true), "queue", 180, 60);
    app.all(["/queue/ticket", "/queue/status"], makeQueueGuard(limiter, true));
    app.post("/queue/ticket", makeQueueTicketHandler({ admission }));
    app.get("/queue/status", makeQueueStatusHandler({ admission }));
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      await run(base);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("issues a grant under the cap, queues past it, and tracks the ticket on poll", async () => {
    await withApp(1, async (base) => {
      const first = await (await fetch(`${base}/queue/ticket`, { method: "POST" })).json();
      expect(first).toMatchObject({ state: "ready" });
      expect(typeof first.grant).toBe("string");

      const second = await (await fetch(`${base}/queue/ticket`, { method: "POST" })).json();
      expect(second).toMatchObject({ state: "queued", position: 1 });

      const polled = await (
        await fetch(`${base}/queue/status?ticket=${encodeURIComponent(second.ticket)}`)
      ).json();
      expect(polled).toMatchObject({ state: "queued", position: 1 });
    });
  });

  it("reports disabled when no cap is set", async () => {
    await withApp(0, async (base) => {
      const body = await (await fetch(`${base}/queue/ticket`, { method: "POST" })).json();
      expect(body).toEqual({ state: "disabled" });
    });
  });

  it("400s a status poll with no ticket and expires an unknown one", async () => {
    await withApp(1, async (base) => {
      const missing = await fetch(`${base}/queue/status`);
      expect(missing.status).toBe(400);

      const unknown = await (await fetch(`${base}/queue/status?ticket=nope`)).json();
      expect(unknown).toEqual({ state: "expired" });
    });
  });
});
