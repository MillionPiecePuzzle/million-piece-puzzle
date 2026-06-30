// Express HTTP layer: auth routes, the profile routes (pseudo, country), the spectator
// stream (keyframe + event windows), and a credentialed-CORS + per-IP
// rate-limit boundary in front of the SPA-facing routes. The WebSocket upgrade
// attaches to the same server in index.ts. Helpers are exported so they can be
// unit tested without booting the process (index.ts runs main() on import).

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ExpressAuth, getSession, type ExpressAuthConfig } from "@auth/express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizeCountry, normalizePseudo } from "@mpp/shared";
import type { ActivityItem, LandingResponse, LeaderboardEntry } from "@mpp/shared";
import { clientIp, type RedisFixedWindow } from "./limits.js";
import { generateClaimToken, hashClaimToken } from "./auth.js";
import { DuplicatePseudoError, type ClaimResult, type UserProfile } from "./mongo.js";
import {
  makeAdminAuth,
  makeAdminClearHandler,
  makeAdminEventStartHandler,
  makeAdminPageHandler,
  makeAdminSwitchHandler,
  type AdminDeps,
} from "./admin.js";

export type PseudoStore = {
  setPseudo: (userId: string, pseudo: string) => Promise<UserProfile>;
};

export type CountryStore = {
  setCountry: (userId: string, country: string) => Promise<UserProfile>;
};

export type GuestStore = {
  createGuest: (input: {
    pseudo: string;
    country: string;
    claimTokenHash: string;
  }) => Promise<{ id: string; user: UserProfile }>;
};

export type ClaimStore = {
  claimGuest: (targetUserId: string, claimTokenHash: string) => Promise<ClaimResult>;
};

// Mints the DB session for a freshly created guest and returns the raw session
// token + expiry for the cookie. Implemented over the Auth.js adapter's
// createSession in index.ts, the same store the WS upgrade reads, so a guest
// cookie passes the session gate with no change to the gate.
export type GuestSessionMinter = {
  mint: (userId: string) => Promise<{ token: string; expires: Date }>;
};

export type InterestedStore = {
  add: (ip: string) => Promise<{ count: number; me: true }>;
  status: (ip: string) => Promise<{ count: number; me: boolean }>;
};

// Compact live figures for the landing, lifted from the in-memory keyframe
// snapshot so the landing never triggers a full-board read. Null until the first
// keyframe is built at boot.
export type LandingSnapshot = {
  lockedCount: number;
  totalPieces: number;
  leaderboard: LeaderboardEntry[];
  activity: ActivityItem[];
};

export type CreateAppDeps = {
  authConfig: ExpressAuthConfig;
  pseudoStore: PseudoStore;
  countryStore: CountryStore;
  guestStore: GuestStore;
  claimStore: ClaimStore;
  guestSessionMinter: GuestSessionMinter;
  // Session cookie identity, mirrored from the Auth.js cookie config so a guest
  // cookie is indistinguishable from a Google one to the WS gate.
  authCookieName: string;
  authSecure: boolean;
  authCookieDomain: string;
  authLimiter: RedisFixedWindow;
  signupLimiter: RedisFixedWindow;
  spectatorLimiter: RedisFixedWindow;
  interested: InterestedStore;
  // Read live (not a captured value) so an admin change to the event start is
  // reflected on the next landing request without a restart.
  eventStartsAt: () => number;
  landingSnapshot: () => LandingSnapshot | null;
  puzzleStatus: () => "active" | "completed";
  puzzleSpan: () => Promise<{ firstAt: number; lastAt: number } | null>;
  appOrigin: string;
  devEnabled: boolean;
  // Spectator stream handlers from keyframe.ts: each writes the response and
  // returns whether it handled the path (always true here, the routes are
  // path-scoped). The events handler serves its sealed-window body asynchronously.
  handleKeyframe: (req: IncomingMessage, res: ServerResponse) => boolean;
  handleEvents: (req: IncomingMessage, res: ServerResponse) => boolean;
  // The direct-URL admin page and its routes, mounted only when provided (i.e.
  // when MPP_ADMIN_PASSWORD is set). Absent leaves /admin unmapped (404).
  admin?: AdminDeps | undefined;
};

export function createApp(deps: CreateAppDeps): Express {
  const app = express();
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  // Spectator stream: anonymous read-only state, wildcard-CORS and CDN-fronted
  // (handled inside the handlers), so it sits outside the credentialed-CORS and
  // auth rate-limit boundary. Its own boundary (per-IP rate limit + query-string
  // rejection) runs first; the handlers then serve the cached body. app.all keeps
  // req.url intact for the handlers' own path/method checks (app.use would strip
  // the mount prefix).
  app.all(["/keyframe", "/events/*"], makeSpectatorGuard(deps.spectatorLimiter, deps.devEnabled));
  app.all("/keyframe", (req, res) => {
    deps.handleKeyframe(req, res);
  });
  app.all("/events/*", (req, res) => {
    deps.handleEvents(req, res);
  });

  // Landing data: the event start (for the countdown) plus the interested count
  // and whether this IP already opted in. Both endpoints are anonymous, share the
  // spectator per-IP guard, and answer with wildcard CORS + no-store. GET /landing
  // sends no query string and POST /interested no body, so both stay CORS simple
  // requests with no preflight (a body or query would draw a preflight, and the
  // guard rejects query strings).
  app.all(["/landing", "/interested"], makeSpectatorGuard(deps.spectatorLimiter, deps.devEnabled));
  app.get(
    "/landing",
    makeLandingHandler({
      interested: deps.interested,
      eventStartsAt: deps.eventStartsAt,
      snapshot: deps.landingSnapshot,
      status: deps.puzzleStatus,
      span: deps.puzzleSpan,
      devEnabled: deps.devEnabled,
    }),
  );
  app.post(
    "/interested",
    makeInterestedHandler({ interested: deps.interested, devEnabled: deps.devEnabled }),
  );

  // Credentialed CORS for the SPA, then the per-IP auth-route window.
  app.use(["/auth", "/profile", "/guest"], makeCors(deps.appOrigin));
  app.use(["/auth", "/profile", "/guest"], makeRateLimit(deps.authLimiter, deps.devEnabled));
  // Stricter per-IP window on the OAuth callback (the GET redirect Google sends
  // back), the account-creation chokepoint. Runs in addition to the auth window.
  app.use("/auth/callback/google", makeRateLimit(deps.signupLimiter, deps.devEnabled));

  app.use("/auth/*", ExpressAuth(deps.authConfig));

  // Guest mint: a real User + DB session with no Google step. The signup window
  // (the same account-creation chokepoint the OAuth callback uses) is route-scoped
  // here so it caps guest creation per IP without touching future /guest/* routes.
  app.post(
    "/guest",
    makeRateLimit(deps.signupLimiter, deps.devEnabled),
    express.json(),
    makeGuestHandler({
      guestStore: deps.guestStore,
      sessionMinter: deps.guestSessionMinter,
      cookieName: deps.authCookieName,
      cookieSecure: deps.authSecure,
      cookieDomain: deps.authCookieDomain,
    }),
  );

  // Claim a guest's contributions for the signed-in user. Rides the shared /guest
  // CORS + auth window (app.use above) but not the signup window: it reattributes,
  // it does not create an account, so the per-IP creation cap must not gate it.
  app.post(
    "/guest/claim",
    express.json(),
    makeClaimHandler({
      getUserId: (req) => sessionUserId(req, deps.authConfig),
      claimStore: deps.claimStore,
    }),
  );

  app.post(
    "/profile/pseudo",
    express.json(),
    makeProfilePseudoHandler({
      getUserId: (req) => sessionUserId(req, deps.authConfig),
      pseudoStore: deps.pseudoStore,
    }),
  );

  app.post(
    "/profile/country",
    express.json(),
    makeProfileCountryHandler({
      getUserId: (req) => sessionUserId(req, deps.authConfig),
      countryStore: deps.countryStore,
    }),
  );

  // Direct-URL admin page, mounted only when a password is configured. Sits
  // outside the SPA CORS/auth-rate boundary (it is a same-origin admin tool, not
  // an SPA route) and behind its own Basic-auth gate.
  if (deps.admin) {
    const adminAuth = makeAdminAuth(deps.admin.password);
    app.get("/admin", adminAuth, makeAdminPageHandler(deps.admin));
    app.post(
      "/admin/event-start",
      adminAuth,
      express.json(),
      makeAdminEventStartHandler(deps.admin),
    );
    app.post("/admin/switch-puzzle", adminAuth, express.json(), makeAdminSwitchHandler(deps.admin));
    app.post("/admin/clear", adminAuth, express.json(), makeAdminClearHandler(deps.admin));
  }

  app.use((_req, res) => {
    res.status(404).type("text/plain; charset=utf-8").send("not found");
  });

  return app;
}

// Credentialed CORS scoped to the SPA origin. The allow-origin must echo the
// exact origin (a wildcard is invalid with credentials), so only the configured
// app origin is allowed; everything else falls through with no CORS headers.
export function makeCors(appOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.headers.origin === appOrigin) {
      res.setHeader("Access-Control-Allow-Origin", appOrigin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

// Per-IP fixed-window gate. Fail-open on a Redis error: a transient outage must
// not lock everyone out of signing in.
export function makeRateLimit(limiter: RedisFixedWindow, devEnabled: boolean) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (await limiter.allow(clientIp(req, devEnabled))) {
        next();
        return;
      }
      res.status(429).type("text/plain; charset=utf-8").send("rate limited");
    } catch (e) {
      console.error("[ratelimit]", (e as Error).message);
      next();
    }
  };
}

// Boundary in front of the anonymous spectator stream. A preflight passes
// straight to the handler (which answers 204 with wildcard CORS). Every other
// request is counted against a per-IP fixed window first, so a flood of any
// request class (including cache-busting GETs) is capped per IP; survivors must
// carry a clean URL. A query string is rejected because the edge keys its cache
// by the full URL, so a random `?cb=` would miss the cache and hit the origin on
// every request (the client never sends one). Rejections carry wildcard CORS so
// a browser fetch can read the status and `no-store` so the CDN never caches a
// 400/429. Fail-open on a Redis error: a transient outage must not take the
// public read path down.
export function makeSpectatorGuard(limiter: RedisFixedWindow, devEnabled: boolean) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.method === "OPTIONS") {
      next();
      return;
    }
    try {
      if (!(await limiter.allow(clientIp(req, devEnabled)))) {
        res
          .status(429)
          .set({
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
            "Retry-After": "1",
          })
          .type("application/json; charset=utf-8")
          .send('{"error":"rate_limited"}');
        return;
      }
    } catch (e) {
      console.error("[spectator ratelimit]", (e as Error).message);
      next();
      return;
    }
    const query = req.query as Record<string, unknown> | undefined;
    if (query && Object.keys(query).length > 0) {
      res
        .status(400)
        .set({ "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" })
        .type("application/json; charset=utf-8")
        .send('{"error":"unexpected_query"}');
      return;
    }
    next();
  };
}

const PUBLIC_NO_STORE = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
} as const;

export type LandingDeps = {
  interested: InterestedStore;
  eventStartsAt: () => number;
  snapshot: () => LandingSnapshot | null;
  status: () => "active" | "completed";
  span: () => Promise<{ firstAt: number; lastAt: number } | null>;
  devEnabled: boolean;
};

// GET /landing: the event start, the interested count and this IP's opt-in state,
// plus the live progress/standings (from the cached keyframe snapshot) and, once
// completed, the recap span. Fail-open on a Redis error (same posture as the
// spectator guard): a transient outage still serves the landing, just with a
// zeroed interested block. The span lookup is skipped unless completed.
export function makeLandingHandler(deps: LandingDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    let interested = { count: 0, me: false };
    try {
      interested = await deps.interested.status(clientIp(req, deps.devEnabled));
    } catch (e) {
      console.error("[landing]", (e as Error).message);
    }
    const snap = deps.snapshot();
    const status = deps.status();
    const body: LandingResponse = {
      eventStartsAt: deps.eventStartsAt(),
      interested,
      status,
      progress: { locked: snap?.lockedCount ?? 0, total: snap?.totalPieces ?? 0 },
      leaderboard: snap?.leaderboard ?? [],
      activity: snap?.activity ?? [],
    };
    if (status === "completed") {
      try {
        const span = await deps.span();
        if (span) body.completion = { at: span.lastAt, startedAt: span.firstAt };
      } catch (e) {
        console.error("[landing span]", (e as Error).message);
      }
    }
    res.status(200).set(PUBLIC_NO_STORE).json(body);
  };
}

export type InterestedDeps = {
  interested: InterestedStore;
  devEnabled: boolean;
};

// POST /interested (no body): registers this IP and returns the live count. The
// SADD is idempotent per IP, so a repeat click does not double-count. Fail-open on
// a Redis error: report the optimistic me=true the caller already assumes, with a
// zero count the next successful GET /landing corrects.
export function makeInterestedHandler(deps: InterestedDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    let result: { count: number; me: true } = { count: 0, me: true };
    try {
      result = await deps.interested.add(clientIp(req, deps.devEnabled));
    } catch (e) {
      console.error("[interested]", (e as Error).message);
    }
    res.status(200).set(PUBLIC_NO_STORE).json(result);
  };
}

export type ProfilePseudoDeps = {
  getUserId: (req: Request) => Promise<string | null>;
  pseudoStore: PseudoStore;
};

export function makeProfilePseudoHandler(deps: ProfilePseudoDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = await deps.getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const pseudo = normalizePseudo((req.body as { pseudo?: unknown } | undefined)?.pseudo);
    if (pseudo === null) {
      res.status(400).json({ error: "invalid_pseudo" });
      return;
    }
    try {
      const profile = await deps.pseudoStore.setPseudo(userId, pseudo);
      res.status(200).json({ user: profile });
    } catch (e) {
      if (e instanceof DuplicatePseudoError) {
        res.status(409).json({ error: "pseudo_taken" });
        return;
      }
      console.error("[profile/pseudo]", (e as Error).message);
      res.status(500).json({ error: "server" });
    }
  };
}

export type ProfileCountryDeps = {
  getUserId: (req: Request) => Promise<string | null>;
  countryStore: CountryStore;
};

export function makeProfileCountryHandler(deps: ProfileCountryDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = await deps.getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const country = normalizeCountry((req.body as { country?: unknown } | undefined)?.country);
    if (country === null) {
      res.status(400).json({ error: "invalid_country" });
      return;
    }
    try {
      const profile = await deps.countryStore.setCountry(userId, country);
      res.status(200).json({ user: profile });
    } catch (e) {
      console.error("[profile/country]", (e as Error).message);
      res.status(500).json({ error: "server" });
    }
  };
}

export type GuestDeps = {
  guestStore: GuestStore;
  sessionMinter: GuestSessionMinter;
  cookieName: string;
  cookieSecure: boolean;
  cookieDomain: string;
};

// POST /guest: mint a guest User (chosen unique pseudo + country, no email) plus a
// DB session, set the session cookie, and return the profile with the one-time
// claim token (the client stores it for a later account sync). A taken pseudo is
// the same 409 a Google account's pseudo change gets, off the same partial-unique
// index. The session is minted through the Auth.js adapter (see the minter), so
// the returned cookie passes the WS session gate unchanged.
export function makeGuestHandler(deps: GuestDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = req.body as { pseudo?: unknown; country?: unknown } | undefined;
    const pseudo = normalizePseudo(body?.pseudo);
    if (pseudo === null) {
      res.status(400).json({ error: "invalid_pseudo" });
      return;
    }
    const country = normalizeCountry(body?.country);
    if (country === null) {
      res.status(400).json({ error: "invalid_country" });
      return;
    }
    const claimToken = generateClaimToken();
    try {
      const { id, user } = await deps.guestStore.createGuest({
        pseudo,
        country,
        claimTokenHash: hashClaimToken(claimToken),
      });
      const session = await deps.sessionMinter.mint(id);
      res.cookie(deps.cookieName, session.token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: deps.cookieSecure,
        expires: session.expires,
        ...(deps.cookieDomain ? { domain: deps.cookieDomain } : {}),
      });
      res.status(201).json({ user, claimToken });
    } catch (e) {
      if (e instanceof DuplicatePseudoError) {
        res.status(409).json({ error: "pseudo_taken" });
        return;
      }
      console.error("[guest]", (e as Error).message);
      res.status(500).json({ error: "server" });
    }
  };
}

export type ClaimDeps = {
  getUserId: (req: Request) => Promise<string | null>;
  claimStore: ClaimStore;
};

// POST /guest/claim: a signed-in user presents a guest's one-time claim token to
// absorb that guest's contributions. The session resolves the claim target (no
// session is minted, the Google session already exists); the store moves the
// guest's cluster_merges to the target, carries over pseudo/country, and deletes
// the guest. A token matching no claimable guest (unknown or already claimed) is
// 404; a caller claiming its own guest session is 409. The raw token never
// reaches the store: only its hash is compared, the same posture as the mint.
export function makeClaimHandler(deps: ClaimDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = await deps.getUserId(req);
    if (!userId) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const token = (req.body as { claimToken?: unknown } | undefined)?.claimToken;
    if (typeof token !== "string" || token.length === 0) {
      res.status(400).json({ error: "invalid_token" });
      return;
    }
    try {
      const result = await deps.claimStore.claimGuest(userId, hashClaimToken(token));
      if (result.status === "not_found") {
        res.status(404).json({ error: "no_claimable_guest" });
        return;
      }
      if (result.status === "self") {
        res.status(409).json({ error: "self_claim" });
        return;
      }
      res.status(200).json({ user: result.user });
    } catch (e) {
      console.error("[guest/claim]", (e as Error).message);
      res.status(500).json({ error: "server" });
    }
  };
}

async function sessionUserId(req: Request, authConfig: ExpressAuthConfig): Promise<string | null> {
  try {
    const session = await getSession(req, authConfig);
    return (session?.user as { id?: string } | undefined)?.id ?? null;
  } catch (e) {
    console.error("[auth session]", (e as Error).message);
    return null;
  }
}
