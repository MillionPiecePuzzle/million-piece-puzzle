# Roadmap

Three phases, eleven tracks. A phase is closed only when its exit criterion is met. Tasks are not estimated. Each task carries an exit criterion, not a description.

Statuses: `[ ]` not started, `[~]` in progress, `[x]` done.

## Tracks

1. `shared-protocol`: shared TS types, WS messages, piece and user schemas
2. `piece-generation`: Bezier silhouettes, snap geometry, piece types
3. `image-pipeline`: libvips processing, Deep Zoom tiles, per-piece AVIF, R2 upload
4. `frontend-shell`: landing, routing, spectator/contributor modes, auth modal
5. `frontend-canvas`: PixiJS rendering, OpenSeadragon, drag/drop, LOD, culling
6. `backend-realtime`: WS server, drag/drop/snap logic, Redis state, Mongo logs, CDN snapshots
7. `auth-and-accounts`: Auth.js (Google, Apple, Reddit), pseudo onboarding, sessions, Turnstile
8. `infra-deploy`: Docker, Coolify, Hetzner, Cloudflare (Pages, R2, CDN, DNS)
9. `tooling-foundations`: monorepo workspaces, shared tsconfig, eslint, prettier
10. `qa-and-load`: load tests up to 1M simulated pieces and clients
11. `legal`: privacy policy, ToS, GDPR notes, license attributions

---

## Phase 0, Local MVP, CLOSED

**Exit criterion (met)**: a single user completes a puzzle of N configurable pieces in a browser, with the full architecture running locally (WS server + Redis + Mongo via docker-compose), in anonymous mode.

### `tooling-foundations`
- [x] Monorepo bootstrapped with `packages/shared`, `packages/frontend`, `packages/server`, shared tsconfig, lint, format, build scripts working end to end

### `shared-protocol`
- [x] WS message types defined (drag, drop, snap, state sync) and importable from both frontend and server
- [x] Piece schema and anonymous user schema defined in `shared`

### `piece-generation`
- [x] Generator produces N unique pieces on a grid, with continuous Bezier edge parameters and matching tabs/blanks between neighbors
- [x] Snap geometry (per-piece canonical offsets, puzzle-global snap tolerance) computed by the generator

### `image-pipeline`
- [x] Local script slices a test image into N AVIF pieces and emits a manifest consumable by the frontend

### `backend-realtime`
- [x] WS server accepts connections, holds authoritative piece state, applies drag/drop/snap, broadcasts updates
- [x] State persisted in Redis, snap events logged to Mongo
- [x] Server starts via docker-compose with Redis and Mongo

### `frontend-shell`
- [x] Two routes: landing and play
- [x] Play page exposes a spectator-to-contributor entry point (floating Contribute CTA opens the auth modal stub)

### `frontend-canvas`
- [x] PixiJS canvas renders the generated pieces from the manifest
- [x] Contributor mode supports drag, drop, and snap with visual feedback
- [x] Snap animation plays when a piece locks (scale bump, flash, easing)
- [x] End-of-puzzle animation plays when the last piece snaps
- [x] Completion is detected and signaled

### `auth-and-accounts`
- [x] Anonymous contributor mode: client connects to WS without auth, server assigns ephemeral id

### `infra-deploy`
- [x] docker-compose up runs server + Redis + Mongo + frontend dev server, ready to play locally

### `qa-and-load`
- (not in Phase 0)

### `legal`
- (not in Phase 0)

### `complementary`
- [x] Polish landed: frame-based anchoring, post-completion confetti loop and congrats modal, jigsaw silhouette tuning, design-handoff `/play` chrome (topbar, zoom rail, Leaderboard and Activity panels, adaptive grid).
- [x] Two code audits cleared: repo green (lint/format/typecheck), doc drift fixed, global serial dispatch queue, disconnect cleanup on-queue, `detectSnap` alignment fix, `SWelcome` trimmed, WS error surfacing, duplication removed, deterministic-core unit tests, pipelined initial Redis write.

---

## Phase 1, Closed Alpha

**Exit criterion**: 5 to 20 invited people, connected concurrently, complete a 10 000-piece puzzle on a deployed instance, in anonymous mode.

### `shared-protocol`
- [x] Protocol version field added to handshake
- [x] Presence messages (join, leave, viewport, cursor) defined

### `piece-generation`
- [ ] Generation validated and stable at 10 000 pieces

### `image-pipeline`
- [ ] Deep Zoom tile pyramid produced for the source image and uploaded to R2
- [ ] Per-piece AVIF set uploaded to R2 with manifest

### `frontend-shell`
- [x] Landing page presents the project and a single CTA to enter the canvas
- [x] Spectator/contributor mode toggle works, no auth required

### `frontend-canvas`
- [ ] OpenSeadragon reference panel shows the source image
- [ ] Frustum culling and LOD active, rendering stays smooth at 10 000 pieces
- [ ] Mini-map shows global progress
- [ ] Collaborator cursors rendered from presence messages (colored pointer, pseudo tag, held-piece preview, idle-bob)

### `backend-realtime`
- [x] Viewport-neighbor broadcast scoping for drag and drop: the `viewport` client message is wired server-side; drag and drop reach only clients whose reported viewport contains the event point, snap stays a global broadcast, and clients with no viewport yet receive everything
- [ ] Periodic snapshot generation published to CDN for spectator mode
- [x] WebSocket messages validated at the dispatch boundary: malformed or out-of-range groupId and non-finite coordinates are rejected as bad_message before any Redis access, and grab on a non-existent group fails instead of creating a junk key
- [x] WebSocket boundary hardened: Origin allowlist (`MPP_ALLOWED_ORIGINS`), per-frame size cap (`maxPayload`), per-connection token-bucket rate limit, and outbound backpressure close on slow consumers

### `auth-and-accounts`
- [x] Anonymous pseudo entry (name, no verification) attached to the session

### `infra-deploy`
- [x] Server deployed on Hetzner via Coolify
- [x] Cloudflare in front for the frontend (Pages on `app.millionpiecepuzzle.com`) and the backend hostname (`ws.millionpiecepuzzle.com`, DNS+SSL via Let's Encrypt at Coolify)
- [ ] Cloudflare CDN edge cache for spectator-mode snapshots
- [ ] R2 buckets configured for tiles and piece textures

### `tooling-foundations`
- [ ] Stable, no further work expected

### `qa-and-load`
- [x] Stateful server logic covered by unit tests: the merge-and-anchor path (`handleDrop` / `applyMerge`) and the serial dispatch queue
- [ ] Load test reproduces 20 concurrent clients dragging on a 10 000-piece puzzle without server saturation

### `legal`
- (not in Phase 1, closed alpha by invitation only)

### `complementary`
- [x] `frontend-shell` + `backend-realtime`: Closed-alpha feedback prep on the `develop` branch: landing passcode gate, sequential rotation of three committed puzzles (`alpha-1` 45 pieces, `alpha-2` 510 pieces, `alpha-3` 2040 pieces) with server-side cycling on completion, dev controls on `/play` (Reset puzzle, Complete & cycle) gated by `MPP_DEV_ENABLED` and `VITE_DEV_BUTTONS`, leaderboard panel hidden for now
- [x] `frontend-shell`: Replace header spectator/contributor toggle with a floating "Contribute" CTA at bottom-right on the spectator view (supersedes the toggle task above)
- [x] `frontend-canvas`: Client emits throttled `viewport` presence messages on pan, zoom, and resize, which activates the server-side drag and drop broadcast scoping
- [ ] `frontend-canvas`: Leaderboard rendered in the completion modal (per-user snap counts derived on demand from `ClusterMerge`)
- [ ] `frontend-shell`: Decide whether to add the live builders indicator (green dot + count) to the topbar
- [ ] `frontend-canvas`: Decide whether to add the Coord HUD overlay (sector / XY / zoom)
- [ ] `frontend-canvas`: Decide whether to add the search bar (jump to coordinates / sector / piece ID, with `⌘K`)
- [ ] `frontend-canvas`: Decide whether to add the minimap / overview panel
- [ ] `frontend-canvas`: Decide whether to add the piece tray (slots + shuffle / auto-sort / draw actions)
- [x] `backend-realtime` + `shared-protocol`: Activity ticker backfilled with recent `ClusterMerge` history on connect, so the feed is populated even for events that happened before the client joined (currently the ticker only shows snaps received live)

---

## Phase 2, Public 1M

**Exit criterion**: the puzzle is open to the public, with 1 000 000 pieces on a single shared canvas, full auth, monitoring sufficient to operate, and legal documents in place.

### `shared-protocol`
- [ ] Protocol frozen at v1, breaking changes go through version bump
- [ ] `eventStartsAt` (unix ms) included in `welcome` so clients can sync the cascade trigger

### `piece-generation`
- [ ] Generation pipeline produces and validates 1 000 000 unique pieces

### `image-pipeline`
- [ ] Gigapixel source processed end to end (Deep Zoom + per-piece AVIF) and hosted on R2

### `frontend-shell`
- [ ] Final landing copy, contributor onboarding flow (login + pseudo creation)
- [ ] Countdown timer on landing while waiting for `eventStartsAt`
- [ ] Auth modal wires Auth.js providers

### `frontend-canvas`
- [ ] Zoom-out LOD uses aggregated tiles instead of per-piece sprites
- [ ] Rendering stays smooth on commodity hardware at 1M pieces
- [ ] Event-start cascade entrance: synchronized across clients at `eventStartsAt`, pieces fall into their shuffled positions, late joiners skip it

### `backend-realtime`
- [ ] Viewport sharding for broadcasts at scale
- [ ] Snapshot cadence tuned for CDN cost vs freshness
- [ ] Basic anti-abuse (rate limiting per session)

### `auth-and-accounts`
- [ ] Auth.js wired with Google, Apple, and Reddit providers
- [ ] Cloudflare Turnstile on login
- [ ] User profiles stored in Mongo, pseudo shown for snap attribution

### `infra-deploy`
- [ ] Production hardening: backups (Redis snapshot, Mongo dump), secrets management, DDoS posture verified

### `qa-and-load`
- [ ] Soak test with simulated traffic at target scale passes without state corruption

### `legal`
- [ ] Privacy policy published
- [ ] Terms of use published
- [ ] GDPR notes added (data collected, retention, contact)
- [ ] License attributions page generated from dependencies

### `complementary`
- (none yet)

---

## Backlog

Ideas worth keeping but not yet committed to a phase. Promote into a phase track when scope and timing are clear.

- **Anti-programmatic-solving via randomized piece ids on the wire.** Goal: a client cannot reconstruct adjacency from indices. Dependency: today the client also reconstructs geometry deterministically from `generationSeed` (see [piece geometry not on the wire](DECISIONS.md#2026-05-12-shared-protocol-piece-geometry-not-on-the-wire)), so the seed would have to stop being shared with clients, and piece silhouettes would have to be served pre-baked (image-pipeline already revisits this in [rectangular tiles](DECISIONS.md#2026-05-12-image-pipeline-rectangular-tiles)). Treat as a pair: id randomization + server-only seed + pre-masked tiles.
- **Dynamic max-zoom that grows with progress.** Cap zoom-out level early in the puzzle and relax it as more pieces are placed, to bound the visible piece count in any viewport. Lighter alternative or complement to the Phase 2 LOD aggregated tiles.
