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

Delivered across all tracks: monorepo with shared tsconfig, lint, format, build end to end; WS message types and piece/anonymous-user schemas in `shared`; procedural Bezier generator with matching tabs/blanks and snap geometry; local AVIF slicer plus manifest; authoritative WS server applying drag/drop/snap with Redis state, Mongo snap log, docker-compose; landing and play routes with a spectator-to-contributor entry; PixiJS canvas with drag/drop/snap feedback, snap and end-of-puzzle animations, completion detection; anonymous ephemeral-id sessions. Polish: frame-based anchoring, confetti loop and congrats modal, silhouette tuning, `/play` chrome (topbar, zoom rail, Leaderboard and Activity panels, adaptive grid). Two code audits cleared: repo green (lint/format/typecheck), doc drift fixed, dispatch queue, disconnect cleanup on-queue, `detectSnap` alignment fix, WS error surfacing, deterministic-core unit tests, pipelined initial Redis write.

---

## Phase 1, Closed Alpha, CLOSED

**Exit criterion (met)**: 5 to 20 invited people, connected concurrently, complete a 10 000-piece puzzle on a deployed instance, in anonymous mode.

Delivered across all tracks: protocol version field in the handshake plus presence messages (join, leave, viewport, cursor); generation validated and stable at 10 000 pieces; Deep Zoom tile pyramid and per-piece AVIF set on R2 with a manifest; landing with a single enter-canvas CTA and a spectator/contributor split where the spectator renders from polled `GET /snapshot` (no WS budget) and Contribute upgrades to a WebSocket, a `puzzleId` change forcing a clean rebuild; OpenSeadragon reference panel, frustum culling smooth at 10 000 pieces, mini-map global progress, collaborator cursors from presence; viewport-neighbor broadcast scoping for drag and drop (snap stays global), periodic CDN snapshots, dispatch-boundary message validation, and a hardened WS boundary (Origin allowlist, payload cap, per-connection token bucket, backpressure close); anonymous pseudo entry attached to the session; server on Hetzner via Coolify, Cloudflare front (Pages `app.`, backend `ws.` with DNS and SSL at Coolify), CDN edge cache for snapshots, R2 buckets for tiles and textures; unit tests for the merge-and-anchor path and the per-group dispatch queue plus a 20-client load test on a 10 000-piece puzzle without saturation.

Complementary: closed-alpha gate (landing passcode, single `alpha-3` puzzle from R2, completion freezes the board), env-gated dev controls usable from any session mode, floating Contribute CTA, throttled `viewport` presence, live leaderboard and backfilled activity ticker, server-computed play-zone hard limits (camera clamp, darkened out-of-bounds, 15% min zoom, minimap with frame/pieces/frustum), scatter shaping decorrelated from the solved image, reference enlarge modal, staged load with progress, and clean reset/complete handling carried into the spectator snapshot. Bugs fixed: transient errors no longer fatal, cleared display objects destroyed, same play zone on all clients, in-flight `build()` guarded against rapid `state` changes, and the stale board (orphaned LOD sprite) cleared on a mode-switch rebuild.

Performance pulled forward from Phase 2, built as the real solution and kept at 1M scale: drag broadcasts coalesced to one per frame, per-group dispatch queues, zoom-out render-texture LOD, and a per-IP rate limit over the per-connection token bucket. Viewport and write sharding stay deferred, blocked on the single-writer alpha topology rather than on piece count.

---

## Phase 2, Public 1M

**Exit criterion**: the puzzle is open to the public, with 1 000 000 pieces on a single shared canvas, full auth, monitoring sufficient to operate, and legal documents in place.

### `shared-protocol`
- [ ] Protocol frozen at v1, breaking changes go through version bump
- [ ] `eventStartsAt` (unix ms) included in `welcome` so clients can sync the cascade trigger

### `piece-generation`
- [ ] Generation pipeline produces and validates 1 000 000 unique pieces

### `image-pipeline`
- [ ] Gigapixel source processed end to end (Deep Zoom + per-piece AVIF, pre-masked alpha-cut server-side) and hosted on R2

### `frontend-shell`
- [ ] Final landing copy, contributor onboarding flow (login + pseudo creation)
- [ ] Countdown timer on landing while waiting for `eventStartsAt`
- [ ] Auth modal wires Auth.js providers

### `frontend-canvas`
- [ ] Zoom-out LOD scales to 1M: move from the Phase 1 render-texture LOD to pipeline aggregated tiles if render-texture does not hold at full scale
- [ ] Viewport-driven texture streaming: fetch only textures for pieces in or near the frustum instead of loading every per-piece AVIF up front. Exit: entering `/play` at 1M does not eagerly fetch all textures; pieces page in and out as the viewport moves; the zoomed-out view renders from aggregated tiles with no per-piece fetch
- [ ] Chunked board build with full status coverage: split the post-download `build()` work (piece-node construction, initial LOD bake) into yielding chunks and report its progress. Exit: the loading status stays accurate from connect to board-on-screen with no uncovered gap after textures reach 100%; building 1M piece nodes does not freeze the main thread
- [ ] Rendering stays smooth on commodity hardware at 1M pieces
- [ ] Event-start cascade entrance: synchronized across clients at `eventStartsAt`, pieces fall into their shuffled positions, late joiners skip it

### `backend-realtime`
- [ ] Viewport sharding for broadcasts at scale
- [ ] Snapshot cadence tuned for CDN cost vs freshness
- [ ] Anti-abuse for public traffic beyond the Phase 1 per-IP rate limit

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
- **Dynamic max-zoom that grows with progress.** Cap zoom-out level early in the puzzle and relax it as more pieces are placed, to bound the visible piece count in any viewport. Lighter alternative or complement to the Phase 2 LOD aggregated tiles. A fixed 15% zoom floor already exists (see [play-zone hard limits](DECISIONS.md#2026-05-21-frontend-canvas-play-zone-hard-limits)); the dynamic, progress-relative version is the open idea here.
- **Coordinate HUD overlay.** Small overlay showing the current viewport position (XY, sector, zoom). Zoom is already shown in the zoom rail, so the marginal value is the XY and a sector readout, which is low at alpha scale and grows with the canvas. Needs a "sector" concept defined first. Revisit at Phase 2 (1M pieces) when orientation on the canvas becomes a real problem.
- **Jump-to search bar (`⌘K`).** Command palette to recenter the camera on a coordinate, sector, or piece id. Depends on a sector concept and a `panTo(worldX, worldY)` camera method (today only `fit` and `center` exist). A navigation aid sized for a huge canvas, not worth building at alpha scale.
- **Bookmark tray (piece shortlist).** Client-side panel of thumbnails for pieces a player flags while hunting; clicking a slot flies the camera to the piece's current position. Geometry is deterministic from the seed, so thumbnails render with no extra data. Pure client-side, no protocol change. No value at alpha scale (the whole board fits on screen); it pays off once the canvas is large enough that pieces cannot be re-found by eye.
- **Spectator stream: keyframe + event-log diffs with client-side interpolation.** Replace the periodic full snapshot with a keyframe (full state, published every N minutes) plus an ordered event log of merges, drops and snaps published every few seconds. Spectator client loads the latest keyframe, applies events, tweens piece positions between ticks and replays snap animations from the log. Trades a few seconds of intentional delay for a much smaller per-tick payload and a more alive rendering. Mandatory at 1M-piece scale where a full snapshot per tick is too large; premature at alpha scale. Pattern is entity interpolation from multiplayer netcode. Beware: a tween between two ticks shows a straight line, not the real drag path, and collapses intermediate handoffs (A grabs, drops, B grabs, drops) into one apparent glide; preserving snap order requires the diff to be an event log with timestamps, not a state delta.
