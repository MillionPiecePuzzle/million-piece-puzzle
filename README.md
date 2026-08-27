# Million Piece Puzzle

A community-built online jigsaw puzzle: **1,000,000 pieces** on a single shared canvas, all shuffled from the start, solved together in real time. A long-form, non-commercial, open-source event with no time limit.

**[Play at app.millionpiecepuzzle.com](https://app.millionpiecepuzzle.com/)**

## Status

v1.2.0 is out: production serves the 1,000,000-piece `earth-mosaic` board ahead of the public event. Work is tracked in [ROADMAP.md](ROADMAP.md).

## How it works

Every player, guest or signed in, connects over a single WebSocket path. Past a global connection cap an admission queue holds new arrivals in a first-in-first-out wait, so the server sheds load into an orderly queue instead of accepting connections until it falls over.

A restart is announced rather than suffered: the server tells every connected player it is going down before it drops the sockets, and the app switches to a maintenance screen (served by Cloudflare Pages, so it survives the backend being gone) that reloads itself back into the board once the server answers again.

Piece events are tiered by cost:

| Event | Scope |
| --- | --- |
| Drag | Broadcast to viewport-neighbor clients, never persisted |
| Drop | Redis write, viewport broadcast |
| Snap | Redis write, Mongo log, global broadcast |

Pieces belong to clusters. Every piece starts as its own cluster; when two pieces of compatible neighboring positions meet at the correct relative offset, their clusters merge and their relative positions freeze. Grabbing any piece grabs its whole cluster, and the wire format carries one absolute position plus a group id rather than N piece positions.

The puzzle frame is the anchor. A cluster locks permanently when a human drop brings its origin within snap tolerance of the frame origin, or when it merges with an already locked cluster. Locked pieces never move again: no undo, no griefing.

Piece geometry is neither stored nor sent. Bezier silhouettes and canonical offsets derive from a server-only generation seed and are baked into each pre-masked tile by the slicer. The client renders from those tiles plus per-piece offsets, so it never holds anything a solver could use.

The source image carries no AI-generated content, a community commitment.

## Stack

- **Frontend** - Vue 3 + TypeScript + Vite, PixiJS (WebGL canvas, frustum culling and LOD), OpenSeadragon
- **Backend** - Node.js + TypeScript, Express, WebSocket, Redis (live state), MongoDB (snap log, user profiles)
- **Auth** - Auth.js (`@auth/express`, Google), database sessions, internal per-IP login rate limiting
- **Assets** - libvips preprocessing, Deep Zoom tile pyramid and per-piece AVIF textures on Cloudflare R2
- **Infra** - Docker + Coolify on OVH, Cloudflare (Pages, R2, CDN)

## Repo layout

```
packages/
  shared/     # Shared TypeScript types (WS messages, piece and user schemas)
  frontend/   # Vue + PixiJS + OpenSeadragon
  server/     # Node + WebSocket + Redis/Mongo handlers
  load-test/  # WS load/soak harness (bots + admission gate)
```

## Running locally

```bash
git clone https://github.com/MillionPiecePuzzle/million-piece-puzzle.git
cd million-piece-puzzle
npm install
cp .env.example .env
docker compose up --build -d
```

Frontend on `http://localhost:5173`, WebSocket server on `ws://localhost:8080/`, anonymous landing data on `http://localhost:8080/landing` and `http://localhost:8080/interested`.

`.env` is gitignored and never committed. Fill it in before bringing the stack up:

- `AUTH_SECRET`, a 32+ character random string, e.g. `openssl rand -hex 32`. Without it the `/auth` routes fail, so the SPA cannot read its session back and mints a fresh guest on every visit.
- `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, from a Google OAuth client whose authorized redirect URI is `http://localhost:8080/auth/callback/google`. Without them the server still runs and guest play works end to end; only Google sign-in and guest claiming are unavailable.

The non-secret auth config (`AUTH_URL`, `AUTH_COOKIE_DOMAIN`, `MPP_APP_ORIGIN`) has local defaults.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run build` | Build shared, then server, then frontend |
| `npm run typecheck` | Typecheck every workspace |
| `npm test` | Run the Vitest suite |
| `npm run lint` | ESLint over the monorepo |
| `npm run format` | Prettier write |
| `npm run dev:frontend` | Vite dev server, outside Docker |
| `npm run dev:server` | Server in watch mode, outside Docker |

The image pipeline carries its own scripts (`slice`, `mosaic`, `upload`, `validate:generation`); see `package.json`.

## Contributing

The wire protocol (v10), schema, and gameplay are frozen for the public event. Code contributions are welcome, but please open an issue first to discuss the change before sending a pull request.

[CLAUDE.md](CLAUDE.md) holds the working conventions, [ROADMAP.md](ROADMAP.md) the tasks and their exit criteria, and [DECISIONS.md](DECISIONS.md) the non-obvious trade-offs along with what would make each worth revisiting.

## Community

Bug reports and feedback go to [GitHub Issues](https://github.com/MillionPiecePuzzle/million-piece-puzzle/issues) or the [Discord](https://discord.gg/mB2juw55R3).

## License

MIT. See [LICENSE](LICENSE).
