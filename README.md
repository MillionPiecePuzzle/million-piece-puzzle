# Million Piece Puzzle

A community-built online jigsaw puzzle: **1,000,000 pieces** on a single shared canvas. A long-form, non-commercial, open-source event.

## Status

Early development. Architecture and stack defined, implementation in progress.

## Stack

- **Frontend** - Vue 3 + TypeScript + Vite, PixiJS (WebGL canvas), OpenSeadragon
- **Backend** - Node.js + TypeScript, WebSocket, Redis (live state), MongoDB (logs)
- **Auth** - Auth.js (Google, Apple, Reddit)
- **Infra** - Docker + Coolify on Hetzner, Cloudflare (Pages, R2, CDN, Turnstile)

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

Frontend on `http://localhost:5173`, WebSocket server on `ws://localhost:8080/`. See [CLAUDE.md](CLAUDE.md) for the working conventions, [ROADMAP.md](ROADMAP.md) for what is in flight, and [DECISIONS.md](DECISIONS.md) for the non-obvious trade-offs.

Bug reports and feedback go to [GitHub Issues](https://github.com/MillionPiecePuzzle/MillionPiecePuzzle/issues).
