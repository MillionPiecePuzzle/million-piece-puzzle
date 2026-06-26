import { describe, it, expect, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import {
  makeAdminAuth,
  makeAdminClearHandler,
  makeAdminEventStartHandler,
  makeAdminPageHandler,
  makeAdminSwitchHandler,
  readAdminOverrides,
  UnknownPuzzleError,
} from "./admin.js";
import type { Redis } from "ioredis";

function fakeRes() {
  const finishHandlers: Array<() => void> = [];
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    finish: () => finishHandlers.forEach((h) => h()),
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
  r.send = vi.fn((b: unknown) => {
    res.body = b;
    return r;
  }) as unknown as Response["send"];
  r.type = vi.fn(() => r) as unknown as Response["type"];
  r.set = vi.fn((k: string, v: string) => {
    res.headers[k] = v;
    return r;
  }) as unknown as Response["set"];
  r.on = vi.fn((event: string, cb: () => void) => {
    if (event === "finish") finishHandlers.push(cb);
    return r;
  }) as unknown as Response["on"];
  return r;
}

function basicHeader(password: string): string {
  return "Basic " + Buffer.from(`admin:${password}`, "utf8").toString("base64");
}

describe("makeAdminAuth", () => {
  function run(authHeader: string | undefined, password: string) {
    const mw = makeAdminAuth(password);
    const res = fakeRes();
    const next: NextFunction = vi.fn();
    mw({ headers: authHeader ? { authorization: authHeader } : {} } as Request, res, next);
    return { res, next };
  }

  it("rejects a missing header with 401 and a Basic challenge", () => {
    const { res, next } = run(undefined, "s3cret");
    const r = res as unknown as { statusCode: number; headers: Record<string, string> };
    expect(r.statusCode).toBe(401);
    expect(r.headers["WWW-Authenticate"]).toContain("Basic");
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts the correct password", () => {
    const { res, next } = run(basicHeader("s3cret"), "s3cret");
    expect((res as unknown as { statusCode: number }).statusCode).toBe(0);
    expect(next).toHaveBeenCalled();
  });

  it("rejects a wrong password", () => {
    const { res, next } = run(basicHeader("nope"), "s3cret");
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a wrong-length password without throwing", () => {
    const { res, next } = run(basicHeader("x"), "s3cret");
    expect((res as unknown as { statusCode: number }).statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("makeAdminPageHandler", () => {
  it("renders the page with the puzzle options and current event start", () => {
    const handler = makeAdminPageHandler({
      puzzles: () => [
        { id: "a", label: "Puzzle A", current: true },
        { id: "b", label: "Puzzle B", current: false },
      ],
      getEventStartsAt: () => 1700000000000,
    });
    const res = fakeRes();
    handler({} as Request, res);
    const r = res as unknown as { statusCode: number; body: string };
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('value="a"');
    expect(r.body).toContain("Puzzle B");
    expect(r.body).toContain("1700000000000");
  });
});

describe("makeAdminEventStartHandler", () => {
  it("400 on a non-integer or negative value", async () => {
    const setEventStartsAt = vi.fn();
    const handler = makeAdminEventStartHandler({ setEventStartsAt });
    const res = fakeRes();
    await handler({ body: { at: -1 } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(setEventStartsAt).not.toHaveBeenCalled();
  });

  it("200 and stores the value", async () => {
    const setEventStartsAt = vi.fn(async () => {});
    const handler = makeAdminEventStartHandler({ setEventStartsAt });
    const res = fakeRes();
    await handler({ body: { at: 0 } } as Request, res);
    expect(setEventStartsAt).toHaveBeenCalledWith(0);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
  });

  it("500 when the store throws", async () => {
    const handler = makeAdminEventStartHandler({
      setEventStartsAt: async () => {
        throw new Error("boom");
      },
    });
    const res = fakeRes();
    await handler({ body: { at: 5 } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(500);
  });
});

describe("makeAdminSwitchHandler", () => {
  it("400 on a missing puzzleId", async () => {
    const switchPuzzle = vi.fn();
    const exit = vi.fn();
    const handler = makeAdminSwitchHandler({ switchPuzzle, exit });
    const res = fakeRes();
    await handler({ body: {} } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(switchPuzzle).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("400 on an unknown puzzle without restarting", async () => {
    const exit = vi.fn();
    const handler = makeAdminSwitchHandler({
      switchPuzzle: async (id) => {
        throw new UnknownPuzzleError(id);
      },
      exit,
    });
    const res = fakeRes();
    await handler({ body: { puzzleId: "ghost" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(exit).not.toHaveBeenCalled();
  });

  it("200 and restarts after the response flushes", async () => {
    const switchPuzzle = vi.fn(async () => {});
    const exit = vi.fn();
    const handler = makeAdminSwitchHandler({ switchPuzzle, exit });
    const res = fakeRes();
    await handler({ body: { puzzleId: "b" } } as Request, res);
    expect(switchPuzzle).toHaveBeenCalledWith("b");
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
    expect(exit).not.toHaveBeenCalled();
    (res as unknown as { finish: () => void }).finish();
    expect(exit).toHaveBeenCalled();
  });
});

describe("makeAdminClearHandler", () => {
  it("400 without the WIPE confirmation", async () => {
    const clearEverything = vi.fn();
    const exit = vi.fn();
    const handler = makeAdminClearHandler({ clearEverything, exit });
    const res = fakeRes();
    await handler({ body: { confirm: "yes" } } as Request, res);
    expect((res as unknown as { statusCode: number }).statusCode).toBe(400);
    expect(clearEverything).not.toHaveBeenCalled();
  });

  it("200, wipes, and restarts after the response flushes", async () => {
    const clearEverything = vi.fn(async () => {});
    const exit = vi.fn();
    const handler = makeAdminClearHandler({ clearEverything, exit });
    const res = fakeRes();
    await handler({ body: { confirm: "WIPE" } } as Request, res);
    expect(clearEverything).toHaveBeenCalled();
    expect((res as unknown as { statusCode: number }).statusCode).toBe(200);
    (res as unknown as { finish: () => void }).finish();
    expect(exit).toHaveBeenCalled();
  });
});

describe("readAdminOverrides", () => {
  function fakeRedis(values: Record<string, string | null>): Redis {
    return {
      get: vi.fn(async (key: string) => values[key] ?? null),
    } as unknown as Redis;
  }

  it("returns the persisted puzzle and event start", async () => {
    const redis = fakeRedis({
      "admin:puzzle-override": JSON.stringify({ puzzleId: "p2", seed: "sd" }),
      "admin:event-start": "1700000000000",
    });
    const out = await readAdminOverrides(redis);
    expect(out).toEqual({
      puzzleId: "p2",
      generationSeed: "sd",
      eventStartsAt: 1700000000000,
    });
  });

  it("returns an empty override when nothing is set", async () => {
    const out = await readAdminOverrides(fakeRedis({}));
    expect(out).toEqual({});
  });

  it("fails soft on malformed JSON", async () => {
    const out = await readAdminOverrides(fakeRedis({ "admin:puzzle-override": "{not json" }));
    expect(out).toEqual({});
  });
});
