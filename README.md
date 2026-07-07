# Million Piece Puzzle

A community-built online jigsaw puzzle: **1,000,000 pieces** on a single shared canvas. A long-form, non-commercial, open-source event.

## Status

Feature-complete. All roadmap phases (local MVP, closed alpha, public 1M, open access) are closed; the production deployment serves a 1,000,000-piece synthetic puzzle ahead of the public event.

## Stack

- **Frontend** - Vue 3 + TypeScript + Vite, PixiJS (WebGL canvas), OpenSeadragon
- **Backend** - Node.js + TypeScript, Express, WebSocket, Redis (live state), MongoDB (logs, user profiles)
- **Auth** - Auth.js (`@auth/express`, Google), database sessions, internal per-IP login rate limiting
- **Infra** - Docker + Coolify on OVH, Cloudflare (Pages, R2, CDN)

## Repo layout

```
packages/
  shared/     # Shared TypeScript types
  frontend/   # Vue + PixiJS + OpenSeadragon
  server/     # Node + WebSocket + Redis/Mongo
  load-test/  # WS load/soak harness (bots + admission gate)
```

## License

See [LICENSE](LICENSE).

## Contributing

The wire protocol (v6), schema, and gameplay are frozen for the public event. Code contributions are welcome but please open an issue first to discuss the change before sending a pull request.

To run the stack locally:

```bash
git clone https://github.com/MillionPiecePuzzle/million-piece-puzzle.git
cd million-piece-puzzle
npm install
docker compose up --build -d
```

Frontend on `http://localhost:5173`, WebSocket server on `ws://localhost:8080/`, and the anonymous landing data on `http://localhost:8080/landing` plus `http://localhost:8080/interested`. See [CLAUDE.md](CLAUDE.md) for the working conventions, [ROADMAP.md](ROADMAP.md) for what is in flight, and [DECISIONS.md](DECISIONS.md) for the non-obvious trade-offs.

Copy `.env.example` to `.env` (gitignored, never committed) and fill in the auth secrets before `docker compose up`: `AUTH_SECRET` (a 32+ character random string, e.g. `openssl rand -hex 32`), plus `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` from a Google OAuth client whose authorized redirect URI is `http://localhost:8080/auth/callback/google`. Without the Google credentials the server still runs and guest play works end to end; only Google sign-in (and guest claiming) is unavailable. Without `AUTH_SECRET` the `/auth` routes fail, so the SPA cannot read its session back and mints a fresh guest on every visit. The non-secret auth config (`AUTH_URL`, `AUTH_COOKIE_DOMAIN`, `MPP_APP_ORIGIN`) has local defaults.

Bug reports and feedback go to [GitHub Issues](https://github.com/MillionPiecePuzzle/million-piece-puzzle/issues).
