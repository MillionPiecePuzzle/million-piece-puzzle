# Roadmap

Four phases, eleven tracks. A phase is closed only when its exit criterion is met. Each task carries an exit criterion, not a description. Detail on non-obvious choices lives in [DECISIONS.md](DECISIONS.md); done tasks here are kept terse.

Statuses: `[ ]` not started, `[~]` in progress, `[x]` done.

## Tracks

1. `shared-protocol`: shared TS types, WS messages, piece and user schemas
2. `piece-generation`: Bezier silhouettes, snap geometry, piece types
3. `image-pipeline`: libvips processing, Deep Zoom tiles, per-piece AVIF, R2 upload
4. `frontend-shell`: landing, routing, entry flow, auth and options modals
5. `frontend-canvas`: PixiJS rendering, OpenSeadragon, drag/drop, LOD, culling
6. `backend-realtime`: WS server, drag/drop/snap logic, Redis state, Mongo logs, snapshots
7. `auth-and-accounts`: Auth.js (Google), guest players, pseudo onboarding, sessions, login anti-abuse
8. `infra-deploy`: Docker, Coolify, OVH, Cloudflare (Pages, R2, CDN, DNS)
9. `tooling-foundations`: monorepo workspaces, shared tsconfig, eslint, prettier
10. `qa-and-load`: load tests up to 1M simulated pieces and clients
11. `legal`: privacy policy, ToS, GDPR notes, license attributions

---

## Phase 0, Local MVP, CLOSED

**Exit criterion (met)**: a single user completes a puzzle of N configurable pieces in a browser, with the full architecture running locally (WS server + Redis + Mongo via docker-compose), in anonymous mode.

## Phase 1, Closed Alpha, CLOSED

**Exit criterion (met)**: 5 to 20 invited people, connected concurrently, complete a 10 000-piece puzzle on a deployed instance, in anonymous mode.

Phase 2 performance was pulled forward and built as the real solution: drag coalescing, per-group dispatch queues, zoom-out LOD, per-IP rate limiting. Viewport and write sharding stay deferred, blocked on the single-writer topology, not on piece count.

---

## Phase 2, Public 1M

**Exit criterion**: the puzzle is open to the public, with 1 000 000 pieces on a single shared canvas, full auth, monitoring sufficient to operate, and legal documents in place.

### `shared-protocol`
- [ ] Protocol frozen at v4 before public launch, breaking changes go through version bump
- [x] `eventStartsAt` (unix ms) in `welcome` to sync the cascade trigger (`MPP_EVENT_STARTS_AT`, default 0 = no scheduled start)
- [x] Anti-programmatic-solving: seed-permuted wire ids, anchor-relative member offsets, server-only seed (`PROTOCOL_VERSION` 4). Deploy step re-uploads R2 under wire-id paths and sets `MPP_GENERATION_SEED`. See DECISIONS

### `piece-generation`
- [x] Generation validates 1 000 000 unique pieces: `validateGeneration` (`npm run validate:generation`) checks ids, offsets, edge params, neighbour agreement, per-seed edge uniqueness. See DECISIONS

### `image-pipeline`
- [x] Piece border baked into the tile: slicer strokes the silhouette over the alpha-cut window before AVIF encode (`borderBaked: true`), frontend drops its render-time stroke. See DECISIONS
- [x] Gigapixel source processed end to end (Deep Zoom + per-piece alpha-cut AVIF) on R2; slicer reads the source via libvips random access (RAM-bounded); `npm run materialize` writes a synthetic tiled BigTIFF the slicer treats like a final photo. Uploading the final asset is the deploy step. See DECISIONS

### `frontend-shell`
- [x] Final landing copy + single CTA gated on event start ("I'm interested" until launch, flips to "Enter the canvas"); closed-alpha passcode removed
- [x] Countdown timer on landing (DD:HH:MM:SS, `useCountdown` off `GET /landing`), "Launching soon" placeholder when no date set
- [x] Auth modal: single "Continue with Google" action running the Auth.js SPA sign-in, return flow forces pseudo then nationality. Google-only by design
- [x] `/play` sealed before a scheduled event: `beforeEnter` guard reads `eventStartsAt` from `GET /landing` and redirects to landing while a real start is future; unset/transient-failure leaves it open. See DECISIONS
- [x] Site localized EN/FR/ES/DE (vue-i18n): every user-facing string and both legal pages, a flag dropdown on the landing (UK/US split for English) switches the whole site, browser language auto-detected and persisted to localStorage

### `frontend-canvas`
- [x] Zoom-out LOD scales to 1M: client-baked tile cache, cull and bake bounded by the visible window via a spatial index
- [x] Viewport-driven texture streaming: per-piece AVIF and nodes hydrated on demand within a viewport ring, freed past a keep ring. See DECISIONS
- [x] Chunked board build: post-download `build()` runs in time-budgeted yielding passes behind a `build` phase, per-piece geometry lazy; loading cover walks connect -> manifest -> build -> textures -> ready with no frozen gap. See DECISIONS
- [x] Smooth at 1M on commodity hardware: fixed z-order layer containers (no `sortableChildren`), geometry cache evicted on dehydrate, deep zoom-out VRAM bounded by freeing covered idle clusters. See DECISIONS
- [x] Per-tile loading indicator: pulsing badge over viewport cells not yet on screen (three states by zoom band), `region_state` coverage rect distinguishes a pending region from an empty one
- [x] Per-tile piece cap: a non-merging drop onto a cell at 8x solved density (`MPP_TILE_PIECE_CAP_MULTIPLIER`) is rejected with a `rollback` + "tile_full" toast; merges and anchors exempt. See DECISIONS
- [x] Single per-frame `reconcile()` is the sole authority for cull, LOD visibility, residency, dirty-flush and loading cells; event handlers only mutate the model and record dirty rects. Extracted pure decisions unit-tested. See DECISIONS
- [x] Zoom in/out stops reloading the window: covered-cold per-piece nodes freed lazily under an LRU `RESIDENT_PIECE_BUDGET`, so a zoom cycle re-uses resident nodes with no re-fetch while a 1M deep zoom-out converges on the budget; `reconcile` crosses the LOD band before the residency pass so a zoom-in re-hydrates uncovered clusters the same frame. See DECISIONS

### `backend-realtime`
- [x] Viewport sharding for broadcasts: spatial broadcast index + cluster-AABB scoping. See DECISIONS
- [x] Group index + partial-state resync on pan: `handleViewport` resyncs newly entered cells via `region_state` (an ordering guard skips held/just-dropped groups). See DECISIONS
- [x] Viewport-scoped initial state on join: `welcome` carries no board (PROTOCOL_VERSION 3); groups stream in per viewport via a `region_state` construction stream from the `GroupIndex`. Minimap from a server-computed density grid plus a live overlay of known regions

### `auth-and-accounts`
- [x] Auth.js wired with the Google provider
- [x] Login anti-abuse: per-IP rate limit on auth routes + per-IP account-creation cap
- [x] User profiles stored in Mongo, pseudo shown for snap attribution

### `infra-deploy`
- [x] Production hardening: backup sidecar (gzipped `mongodump` + Redis RDB to private `mpp-backups` R2 every 6h, keep-3), secrets in the Coolify env, `ws.*` Cloudflare-proxied with an Origin CA cert (Full strict) + 30s WS heartbeat. Firewalling the origin to Cloudflare ranges stays the open DDoS gap (backlog). See DECISIONS
- [x] Frontend dropped from the Coolify deploy: `docker-compose.yml` no longer defines the Vite dev `frontend` service (it lives in `docker-compose.override.yml` for local dev), prod `app.*` is Cloudflare Pages. Manual follow-up: remove the unused `VITE_WS_URL`/`VITE_AUTH_BASE_URL`/`MPP_ALLOWED_HOSTS` from the Coolify service env, then redeploy.
- [x] Admin ops page: direct-URL Basic-auth `GET /admin` (mounted only when `MPP_ADMIN_PASSWORD` is set) to wipe Redis+Mongo, set the event start, switch the active puzzle; switch + wipe persist a Redis override and restart the container, event start applies live. Manual follow-up: set `MPP_ADMIN_PASSWORD` and `MPP_ADMIN_PUZZLES` (JSON `[{id,label,seed}]`) in the Coolify env, then redeploy. See DECISIONS

### `qa-and-load`
- [x] Load-test bots authenticate past the WS session gate: harness seeds a disposable user + DB session per bot in Mongo and sends the matching cookie. Verified at 10 000 (anonymous rejected, ~160 drag/s sustained, clean teardown). See DECISIONS
- [~] Soak test with simulated traffic at target scale passes without state corruption. Tooling built: `validate-state` asserts partition/locked/held invariants + Mongo-replay-equals-Redis at rest; harness `--spoof-ip-base` drives >cap bots from one host. See DECISIONS. Pending: run the prod soak + validator against the OVH VPS-3 (12 GB)

### `legal`
- [x] Privacy policy published: public `/privacy` page, linked from the landing footer
- [x] GDPR notes folded into `/privacy` (data collected, retention, access/erasure/portability, Discord contact); `/legal` notice page ships alongside
- [x] License attributions: Open-source licenses section on `/legal` (Vue, Vue Router, PixiJS, OpenSeadragon). Terms of use intentionally dropped (non-commercial, no chat, permanent pieces)

### `complementary`
- [x] Landing interested counter: opt-in button registers the visitor and shows the public count, deduped per IP via a hashed-IP Redis set (`GET /landing` + `POST /interested`). See DECISIONS
- [x] Contributor nationality: required onboarding step after the pseudo, stored on the profile; leaderboard avatar is the round country flag
- [x] Edge-pan navigation: during a press-drag the camera scrolls toward a canvas edge when the pointer rests in an edge band (RTS-style), driven by the Pixi ticker, suppressed during a manual background pan
- [x] Sticky carry mode: double-click sticks a cluster to the cursor (move + edge-pan/zoom with no button held), double-click drops, Escape returns it, 30s idle timeout. See DECISIONS
- [x] Sticky-carry cursor offset: a carried cluster floats to the upper-right of the cursor with its bounding-box corner held a constant screen-space gap clear of the pointer at any zoom; pan and zoom work mid-carry, a double-click drop lands the cluster at the cursor. Press-drag unchanged
- [x] Add a global timer on the play page
- [x] More info in the activity panel: snap (loose merge) vs place (anchored), each as a single piece or an N-piece cluster, driven by `droppedSize`/`mergedSize` on the snap event. See DECISIONS
- [x] Landing reflects the event lifecycle: countdown before the start, live progress (locked/total bar) plus an activity + leaderboard block during, and a completed recap (COMPLETED, date, event duration, final leaderboard) after. Driven by `GET /landing` (`status`/`progress`/`leaderboard`/`activity`/`completion`); live figures from the in-memory keyframe snapshot, completed span from a `puzzleId_at`-indexed first/last merge lookup
- [x] Snap particle burst: a small spark burst radiates from each piece the instant it locks (snap or anchor), on the Pixi ticker, capped per snap event
- [x] Brand mark as favicon and Discord icon: cream-tiled SVG favicon + apple-touch PNG in index.html, plus a 512px Discord server-icon PNG, generated from the BrandMark glyph via `npm run icons`
- [x] Minimap navigation: a primary-button press on the overview recenters the camera on that world point, a hold-drag (tracked past the panel edge via pointer capture) sweeps it continuously, clamped to the play zone

---

## Phase 3, Open Access (guest-first)

**Exit criterion**: a first-time visitor reaches the canvas and places a piece without an OAuth redirect (instant guest identity, in-site pseudo + country modals); signing in with Google claims and keeps the guest's contributions under one identity; a single real-time path serves everyone, gated by an admission queue under load; the spectator read-path is retired.

Migration order under the single prod, no staging: A is pure addition (the spectator still cohabits), B puts the admission safety valve in place before C removes the CDN read-path. Each ships on its own and leaves the app working.

### `auth-and-accounts`
- [~] Guest players (Chantier A): `POST /guest` mints a real User (`guest:true`, chosen unique pseudo + country, no email) plus a DB session, rate-limited per IP; the WS session gate is unchanged. Exit: a fresh visitor reaches `/play` and drags a piece with no Google step. Backend landed (endpoint, schema, session, indexes). Pending: the Single Play entry that calls it. See DECISIONS
- [x] Claim on sign-in (Chantier A): `POST /guest/claim` reattributes the guest's `cluster_merges` to the Google user, carries over pseudo/country, deletes the guest doc; one path for new and existing Google accounts. Exit: a guest who placed pieces then signs in keeps them credited under one identity. See DECISIONS

### `frontend-shell`
- [ ] Single "Play" entry (Chantier A): the landing CTA goes straight to `/play`, guest minted on demand; the spectator/contributor split is gone. Exit: no mode toggle remains in the UI
- [ ] Options menu (Chantier A): a gear icon by the pseudo (top-right) opens a modal (sync account, sign out, change pseudo, change country), replacing the "become a contributor" card above the minimap. Exit: `ContributeFab` removed, the gear modal drives sync/sign-out/profile edits

### `backend-realtime`
- [ ] Admission queue (Chantier B): a global cap (`MPP_MAX_ACTIVE_CONNECTIONS`) on `hub.allClients().size`, a ticket queue (`POST /queue/ticket`, `GET /queue/status`) issuing TTL'd grants, the WS upgrade admitting `?grant=`. Exit: past the cap a new client waits and is admitted when a slot frees. See DECISIONS
- [ ] Retire the spectator read-path (Chantier C): remove `GET /keyframe` + `GET /events`, the `EventLog`, the spectator rate limiter, and the spectator-only fields of the keyframe. `KeyframePublisher`, the `minimap` broadcast and the landing snapshot are kept as-is. Exit: no public read-stream endpoint remains, minimap and landing live figures still work

### `frontend-canvas`
- [ ] Remove the spectator transport (Chantier C): drop the keyframe-tailing/window ingest from `usePuzzleSession` and `puzzleStage` and the spectator branches in `PuzzleCanvas`; the canvas is WS-only. Exit: one transport, contributor minimap unchanged

### `shared-protocol`
- [ ] Drop the spectator wire types (Chantier C): remove `SpectatorKeyframe`/`SpectatorEvent`/`SpectatorEventWindow` and `SPECTATOR_FORMAT_VERSION`; keep the minimap grid; bump `PROTOCOL_VERSION`. Exit: build green, version asserted at handshake

---

## Backlog

Ideas worth keeping but not yet committed to a phase. Promote into a phase track when scope and timing are clear.

- **Dynamic max-zoom that grows with progress.** Cap zoom-out early and relax it as pieces are placed, to bound the visible piece count. A fixed 15% zoom floor already exists (see [play-zone hard limits](DECISIONS.md#2026-05-21-frontend-canvas-play-zone-hard-limits)); the progress-relative version is the open idea.
- **Coordinate HUD overlay.** Small overlay showing viewport position (XY, sector, zoom). Needs a "sector" concept first. Revisit at 1M when orientation becomes a real problem.
- **Firewall the origin to Cloudflare IP ranges.** Closes the last DDoS gap: the VPS is still directly reachable so the edge is bypassable and `CF-Connecting-IP` is spoofable. OVH Network Firewall allowing 80/443 from Cloudflare ranges + admin IP, 22 from admin IP, at the network edge. Steps in [DECISIONS topology](DECISIONS.md#2026-05-18-infra-deploy-alpha-topology).
