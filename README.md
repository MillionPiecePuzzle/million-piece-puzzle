# Million Piece Puzzle

A community-built online jigsaw puzzle: **1,000,000 pieces** on a single shared canvas. A long-form, non-commercial, open-source event.

## Status

Early development. Architecture and stack defined, implementation in progress.

## Stack

- **Frontend** - Vue 3 + TypeScript + Vite, PixiJS (WebGL canvas), OpenSeadragon
- **Backend** - Node.js + TypeScript, Express, WebSocket, Redis (live state), MongoDB (logs, user profiles)
- **Auth** - Auth.js (`@auth/express`, Google), database sessions, internal per-IP login rate limiting
- **Infra** - Docker + Coolify on Hetzner, Cloudflare (Pages, R2, CDN)

## Repo layout

```
packages/
  shared/    # Shared TypeScript types
  frontend/  # Vue + PixiJS + OpenSeadragon
  server/    # Node + WebSocket + Redis/Mongo
```

## License

See [LICENSE](LICENSE).

## Contributing

The project is in closed alpha and the API, schema, and gameplay are still moving fast. Code contributions are welcome but please open an issue first to discuss the change before sending a pull request.

To run the stack locally:

```bash
git clone https://github.com/MillionPiecePuzzle/MillionPiecePuzzle.git
cd MillionPiecePuzzle
npm install
docker compose up --build -d
```

Frontend on `http://localhost:5173`, WebSocket server on `ws://localhost:8080/`, spectator snapshot on `http://localhost:8080/snapshot`. See [CLAUDE.md](CLAUDE.md) for the working conventions, [ROADMAP.md](ROADMAP.md) for what is in flight, and [DECISIONS.md](DECISIONS.md) for the non-obvious trade-offs.

Contributor sign-in needs Google OAuth credentials. Copy `.env.example` to `.env` (gitignored, never committed) and fill these in before `docker compose up`: `AUTH_SECRET` (a 32+ character random string, e.g. `openssl rand -hex 32`), `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET` from a Google OAuth client whose authorized redirect URI is `http://localhost:8080/auth/callback/google`. Without them the server still boots and spectator mode works; only contribution (the authenticated WebSocket) is unavailable. The non-secret auth config (`AUTH_URL`, `AUTH_COOKIE_DOMAIN`, `MPP_APP_ORIGIN`) has local defaults.

Bug reports and feedback go to [GitHub Issues](https://github.com/MillionPiecePuzzle/MillionPiecePuzzle/issues).
