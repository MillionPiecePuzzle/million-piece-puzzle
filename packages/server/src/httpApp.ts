// Express HTTP layer: auth routes, the pseudo-profile route, the spectator
// stream (keyframe + event windows), and a credentialed-CORS + per-IP
// rate-limit boundary in front of the SPA-facing routes. The WebSocket upgrade
// attaches to the same server in index.ts. Helpers are exported so they can be
// unit tested without booting the process (index.ts runs main() on import).

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ExpressAuth, getSession, type ExpressAuthConfig } from "@auth/express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizePseudo } from "@mpp/shared";
import { clientIp, type RedisFixedWindow } from "./limits.js";
import { DuplicatePseudoError, type UserProfile } from "./mongo.js";

export type PseudoStore = {
  setPseudo: (userId: string, pseudo: string) => Promise<UserProfile>;
};

export type CreateAppDeps = {
  authConfig: ExpressAuthConfig;
  pseudoStore: PseudoStore;
  authLimiter: RedisFixedWindow;
  signupLimiter: RedisFixedWindow;
  appOrigin: string;
  devEnabled: boolean;
  // Spectator stream handlers from keyframe.ts: each writes the response and
  // returns whether it handled the path (always true here, the routes are
  // path-scoped). The events handler serves its sealed-window body asynchronously.
  handleKeyframe: (req: IncomingMessage, res: ServerResponse) => boolean;
  handleEvents: (req: IncomingMessage, res: ServerResponse) => boolean;
};

export function createApp(deps: CreateAppDeps): Express {
  const app = express();
  app.set("trust proxy", true);
  app.disable("x-powered-by");

  // Spectator stream: anonymous read-only state, wildcard-CORS and CDN-fronted
  // (handled inside the handlers), so it sits outside the credentialed-CORS and
  // auth rate-limit boundary. app.all keeps req.url intact for the handlers' own
  // path/method checks (app.use would strip the mount prefix).
  app.all("/keyframe", (req, res) => {
    deps.handleKeyframe(req, res);
  });
  app.all("/events/*", (req, res) => {
    deps.handleEvents(req, res);
  });

  // Credentialed CORS for the SPA, then the per-IP auth-route window.
  app.use(["/auth", "/profile"], makeCors(deps.appOrigin));
  app.use(["/auth", "/profile"], makeRateLimit(deps.authLimiter, deps.devEnabled));
  // Stricter per-IP window on the OAuth callback (the GET redirect Google sends
  // back), the account-creation chokepoint. Runs in addition to the auth window.
  app.use("/auth/callback/google", makeRateLimit(deps.signupLimiter, deps.devEnabled));

  app.use("/auth/*", ExpressAuth(deps.authConfig));

  app.post(
    "/profile/pseudo",
    express.json(),
    makeProfilePseudoHandler({
      getUserId: (req) => sessionUserId(req, deps.authConfig),
      pseudoStore: deps.pseudoStore,
    }),
  );

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

async function sessionUserId(req: Request, authConfig: ExpressAuthConfig): Promise<string | null> {
  try {
    const session = await getSession(req, authConfig);
    return (session?.user as { id?: string } | undefined)?.id ?? null;
  } catch (e) {
    console.error("[auth session]", (e as Error).message);
    return null;
  }
}
