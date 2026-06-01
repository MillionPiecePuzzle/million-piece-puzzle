import { describe, it, expect, vi } from "vitest";
import type { Adapter } from "@auth/core/adapters";
import { readCookie, sessionCookieName, resolveSessionUser } from "./auth.js";

describe("sessionCookieName", () => {
  it("prefixes with __Secure- only when secure", () => {
    expect(sessionCookieName(true)).toBe("__Secure-authjs.session-token");
    expect(sessionCookieName(false)).toBe("authjs.session-token");
  });
});

describe("readCookie", () => {
  it("returns null for a missing header or absent cookie", () => {
    expect(readCookie(undefined, "a")).toBeNull();
    expect(readCookie("b=1; c=2", "a")).toBeNull();
  });

  it("extracts and url-decodes a named cookie among others", () => {
    expect(readCookie("x=1; authjs.session-token=tok%20en; y=2", "authjs.session-token")).toBe(
      "tok en",
    );
  });

  it("does not match a cookie name as a substring", () => {
    expect(readCookie("xauthjs.session-token=nope", "authjs.session-token")).toBeNull();
  });
});

function adapterWith(
  result: Awaited<ReturnType<NonNullable<Adapter["getSessionAndUser"]>>>,
): Adapter {
  return { getSessionAndUser: vi.fn(async () => result) } as unknown as Adapter;
}

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe("resolveSessionUser", () => {
  const cookie = (token: string) => `authjs.session-token=${token}`;

  it("resolves the user for a valid, unexpired session", async () => {
    const adapter = adapterWith({
      session: { sessionToken: "good", userId: "u1", expires: future() },
      user: { id: "u1", email: "a@b.c", emailVerified: null },
    });
    const res = await resolveSessionUser(cookie("good"), adapter, false);
    expect(res?.user.id).toBe("u1");
    expect(adapter.getSessionAndUser).toHaveBeenCalledWith("good");
  });

  it("returns null when the cookie is absent", async () => {
    const adapter = adapterWith(null);
    expect(await resolveSessionUser(undefined, adapter, false)).toBeNull();
    expect(adapter.getSessionAndUser).not.toHaveBeenCalled();
  });

  it("reads the secure cookie name when secure", async () => {
    const adapter = adapterWith({
      session: { sessionToken: "good", userId: "u1", expires: future() },
      user: { id: "u1", email: "a@b.c", emailVerified: null },
    });
    // A non-secure cookie name is ignored when secure is requested.
    expect(await resolveSessionUser(cookie("good"), adapter, true)).toBeNull();
    expect(
      await resolveSessionUser(`__Secure-authjs.session-token=good`, adapter, true),
    ).not.toBeNull();
  });

  it("returns null for an unknown token", async () => {
    const adapter = adapterWith(null);
    expect(await resolveSessionUser(cookie("nope"), adapter, false)).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const adapter = adapterWith({
      session: { sessionToken: "old", userId: "u1", expires: past() },
      user: { id: "u1", email: "a@b.c", emailVerified: null },
    });
    expect(await resolveSessionUser(cookie("old"), adapter, false)).toBeNull();
  });
});
