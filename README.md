# Million Piece Puzzle

A community-built online jigsaw puzzle: **1,000,000 pieces** on a single shared canvas. A long-form, non-commercial, open-source event.

## Status

Early development. Architecture and stack defined, implementation in progress.

## Stack

- **Frontend** — Vue 3 + TypeScript + Vite, PixiJS (WebGL canvas), OpenSeadragon
- **Backend** — Node.js + TypeScript, WebSocket, Redis (live state), MongoDB (logs)
- **Auth** — Auth.js (Google, Apple, Reddit)
- **Infra** — Docker + Coolify on Hetzner, Cloudflare (Pages, R2, CDN, Turnstile)

## Repo layout

```
packages/
  shared/    # Shared TypeScript types
  frontend/  # Vue + PixiJS + OpenSeadragon
  server/    # Node + WebSocket + Redis/Mongo
```

## Deployment

See [DEPLOY.md](DEPLOY.md) for the Hetzner + Coolify + Cloudflare Pages runbook.

## License

See [LICENSE](LICENSE).

## Contributing

Contribution guidelines coming soon.
