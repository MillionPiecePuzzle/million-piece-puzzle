// Auth.js (@auth/express) configuration and session helpers.
//
// Identity is Google-only with database sessions: the session cookie holds an
// opaque token resolved against the `sessions` collection. The same adapter
// instance backs both the HTTP auth routes and the WS upgrade, which reads the
// parent-domain session cookie to authenticate the connection.

import { createHash, randomBytes } from "node:crypto";
import type { ExpressAuthConfig } from "@auth/express";
import Google from "@auth/express/providers/google";
import type { Adapter, AdapterSession, AdapterUser } from "@auth/core/adapters";

// Guest session lifetime, matching the Auth.js database-session default (30 days)
// so a guest cookie ages out like a Google one.
export const GUEST_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Claim token handed to a guest at creation (stored client-side) and verified by
// POST /guest/claim. Only its sha256 is stored on the guest doc, so a leaked
// database row cannot impersonate the guest, the same posture as a session token.
export function generateClaimToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type AuthConfigOptions = {
  adapter: Adapter;
  // Whether the session cookie is marked Secure (https). Also selects the
  // cookie-name prefix.
  secure: boolean;
  // Domain attribute for the session cookie, "" for host-only.
  cookieDomain: string;
  // SPA origin permitted as an OAuth redirect target.
  appOrigin: string;
};

export function buildAuthConfig(opts: AuthConfigOptions): ExpressAuthConfig {
  return {
    adapter: opts.adapter,
    providers: [Google],
    session: { strategy: "database" },
    trustHost: true,
    cookies: {
      sessionToken: {
        name: sessionCookieName(opts.secure),
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: opts.secure,
          ...(opts.cookieDomain ? { domain: opts.cookieDomain } : {}),
        },
      },
    },
    callbacks: {
      // The SPA lives on a different origin from the auth host (a sibling
      // subdomain in prod, a different port in dev). Without this, Auth.js
      // collapses any non-auth-host callback URL back to the auth host, so the
      // post-login redirect would land on ws.* instead of app.*.
      redirect({ url, baseUrl }) {
        const allowed = new Set([baseUrl, opts.appOrigin]);
        try {
          if (allowed.has(new URL(url).origin)) return url;
        } catch {
          // Not an absolute URL: fall through.
        }
        if (url.startsWith("/")) return `${baseUrl}${url}`;
        return opts.appOrigin;
      },
      // Database strategy: surface the user id, pseudo and country so
      // GET /auth/session can drive the forced onboarding steps and snap
      // attribution.
      session({ session, user }) {
        session.user.id = user.id;
        (session.user as { pseudo?: string | null }).pseudo =
          (user as { pseudo?: string | null }).pseudo ?? null;
        (session.user as { country?: string | null }).country =
          (user as { country?: string | null }).country ?? null;
        return session;
      },
    },
    events: {
      // The adapter inserts only the OAuth profile, so the createdAt stamp is
      // added here on first sign-in.
      async createUser({ user }) {
        if (!user.id || !opts.adapter.updateUser) return;
        await opts.adapter.updateUser({
          id: user.id,
          createdAt: new Date(),
        } as Parameters<NonNullable<Adapter["updateUser"]>>[0]);
      },
    },
  };
}

export function sessionCookieName(secure: boolean): string {
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

// Resolve the authenticated user from a raw Cookie header via the adapter's
// database session lookup. Returns null for a missing, unknown, or expired
// session, which the WS upgrade treats as "reject".
export async function resolveSessionUser(
  cookieHeader: string | undefined,
  adapter: Adapter,
  secure: boolean,
): Promise<{ session: AdapterSession; user: AdapterUser } | null> {
  const token = readCookie(cookieHeader, sessionCookieName(secure));
  if (!token || !adapter.getSessionAndUser) return null;
  const res = await adapter.getSessionAndUser(token);
  if (!res) return null;
  if (res.session.expires.getTime() <= Date.now()) return null;
  return res;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
