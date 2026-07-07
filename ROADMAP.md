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

## Phase 2, Public 1M, CLOSED

**Exit criterion (met)**: the puzzle is open to the public, with 1 000 000 pieces on a single shared canvas, full auth, monitoring sufficient to operate, and legal documents in place.

`MPP_DEV_ENABLED`/`VITE_DEV_BUTTONS` still default to on in prod (see [DECISIONS](DECISIONS.md#2026-05-18-frontend-shell-dev-controls)); flipping both is the last step before advertising the URL.

### `shared-protocol`
- [x] Protocol frozen at v6 before public launch (bumped 4->5->6 for activity-feed sizes and the spectator drop); breaking changes go through a version bump asserted at the `hello` handshake. See DECISIONS
- [x] `eventStartsAt` (unix ms) in `welcome` syncs the cascade trigger (`MPP_EVENT_STARTS_AT`, default 0 = no scheduled start)
- [x] Anti-programmatic-solving: seed-permuted wire ids, anchor-relative member offsets, server-only seed. See DECISIONS

### `piece-generation`
- [x] Generation validates 1 000 000 unique pieces (`npm run validate:generation`): ids, offsets, edge params, neighbour agreement, per-seed edge uniqueness. See DECISIONS

### `image-pipeline`
- [x] Piece border baked into the tile at slice time; frontend drops its render-time stroke. See DECISIONS
- [x] Gigapixel pipeline (Deep Zoom + per-piece alpha-cut AVIF) runs end to end on R2 via libvips random access; `npm run materialize` builds a synthetic BigTIFF stand-in for dev. Uploading the final asset is the deploy step. See DECISIONS

### `frontend-shell`
- [x] Landing: final copy, single CTA gated on event start ("I'm interested" until launch, "Enter the canvas" after); closed-alpha passcode removed
- [x] Countdown timer on landing (DD:HH:MM:SS, `useCountdown` off `GET /landing`), placeholder when unscheduled
- [x] Auth modal: single "Continue with Google" action, return flow forces pseudo then nationality. Google-only by design
- [x] `/play` sealed before a scheduled event: `beforeEnter` guard reads `eventStartsAt`, fail-open on an unset date or a transient fetch failure. See DECISIONS
- [x] Site localized EN/FR/ES/DE (vue-i18n): every user-facing string and both legal pages, flag dropdown on the landing, browser language auto-detected and persisted

### `frontend-canvas`
- [x] Zoom-out LOD scales to 1M via a client-baked tile cache, cull and bake bounded by the visible window through a spatial index
- [x] Viewport-driven texture streaming: per-piece textures and nodes hydrate on demand within a viewport ring, freed past a keep ring. See DECISIONS
- [x] Chunked, time-budgeted board build behind a `build` loading phase, per-piece geometry lazy; no frozen gap. See DECISIONS
- [x] Smooth at 1M: fixed z-order layers (no `sortableChildren`), evicted geometry cache, deep zoom-out VRAM bounded by freeing covered idle clusters. See DECISIONS
- [x] Per-tile loading indicator: pulsing badge over viewport cells not yet on screen, `region_state` coverage distinguishes pending from empty
- [x] Per-tile piece cap: a non-merging drop onto a cell at 8x solved density is rejected with a `rollback` + "tile_full" toast; merges and anchors exempt. See DECISIONS
- [x] Single per-frame `reconcile()` is the sole authority for cull, LOD visibility, residency, dirty-flush and loading cells; pure decisions extracted and unit-tested. See DECISIONS
- [x] Zoom in/out stops reloading the window: covered-cold nodes freed lazily under an LRU budget, so a zoom cycle re-uses resident nodes with no re-fetch even at a 1M deep zoom-out. See DECISIONS

### `backend-realtime`
- [x] Viewport sharding for broadcasts: spatial broadcast index + cluster-AABB scoping. See DECISIONS
- [x] Group index + partial-state resync on pan: `handleViewport` resyncs newly entered cells via `region_state`. See DECISIONS
- [x] Viewport-scoped initial state on join: `welcome` carries no board (protocol v3); groups stream in per viewport, minimap from a server-computed density grid. See DECISIONS
- [x] Paced `region_state` resync: a large viewport jump on a fragmented board chunks its newly entered cells into several paced batches instead of one send, avoiding the WS backpressure close (code 1013) a 2026-07-05 soak logged 25 times; a later `viewport` on the same connection supersedes an in-flight stream. Re-soak confirmed clean. See DECISIONS

### `auth-and-accounts`
- [x] Auth.js wired with the Google provider
- [x] Login anti-abuse: per-IP rate limit on auth routes + per-IP account-creation cap
- [x] User profiles stored in Mongo, pseudo shown for snap attribution
- [x] 24h cooldown on pseudo and country changes, initial onboarding choice exempt. See DECISIONS

### `infra-deploy`
- [x] Production hardening: backup sidecar to a private R2 bucket every 6h keep-3, secrets in the Coolify env, `ws.*` Cloudflare-proxied with an Origin CA cert + 30s WS heartbeat. Firewalling the origin to Cloudflare ranges stays the open DDoS gap (backlog). See DECISIONS
- [x] Frontend dropped from the Coolify deploy: prod `app.*` is Cloudflare Pages. Manual follow-up: remove the unused `VITE_WS_URL`/`VITE_AUTH_BASE_URL`/`MPP_ALLOWED_HOSTS` from the Coolify service env, then redeploy.
- [x] Admin ops page: direct-URL Basic-auth `GET /admin` to wipe Redis+Mongo, set the event start, switch the active puzzle. Manual follow-up: set `MPP_ADMIN_PASSWORD` and `MPP_ADMIN_PUZZLES` in the Coolify env, then redeploy. See DECISIONS

### `qa-and-load`
- [x] Load-test bots authenticate past the WS session gate via a seeded Mongo user + DB session; verified at 10 000 (anonymous rejected, ~160 drag/s sustained, clean teardown). See DECISIONS
- [x] Soak test at target scale passes with no state corruption: `validate-state` asserts partition/locked/held invariants against a Mongo-replay-equals-Redis check; harness `--spoof-ip-base` drives >cap bots from one host. Verified on the OVH VPS-3 (12 GB): 50 bots, 15 min, clean state (all ten checks pass, including no group held at rest). See DECISIONS

### `legal`
- [x] Privacy policy published: public `/privacy` page, linked from the landing footer
- [x] GDPR notes folded into `/privacy` (data collected, retention, access/erasure/portability, Discord contact); `/legal` notice page ships alongside
- [x] License attributions: open-source licenses section on `/legal`. Terms of use intentionally dropped (non-commercial, no chat, permanent pieces)

### `complementary`
- [x] Landing interested counter: opt-in button registers the visitor and shows the public count, deduped per IP via a hashed-IP Redis set. See DECISIONS
- [x] Contributor nationality: required onboarding step after the pseudo; leaderboard avatar is the round country flag
- [x] Edge-pan navigation: during a press-drag the camera scrolls toward a canvas edge when the pointer rests in an edge band (RTS-style)
- [x] Sticky carry mode: double-click sticks a cluster to the cursor, double-click drops, Escape returns it, 30s idle timeout. See DECISIONS
- [x] Sticky-carry cursor offset: a carried cluster floats clear of the pointer at any zoom; pan and zoom work mid-carry
- [x] Global timer on the play page
- [x] More info in the activity panel: snap (loose merge) vs place (anchored), each as a single piece or an N-piece cluster. See DECISIONS
- [x] Landing reflects the event lifecycle: countdown before the start, live progress plus activity + leaderboard during, completed recap after
- [x] Snap particle burst: a small spark burst radiates from each piece the instant it locks, capped per snap event
- [x] Brand mark as favicon and Discord icon, generated from the BrandMark glyph via `npm run icons`
- [x] Minimap navigation: a press recenters the camera, a hold-drag sweeps it continuously, clamped to the play zone
- [x] Topbar presence indicator: the "connected" label is folded into a tooltip on the status dot
- [x] Countdown unit labels: each digit group gets a Days/Hours/Minutes/Seconds label, localized across all four locales

---

## Phase 3, Open Access (guest-first), CLOSED

**Exit criterion (met)**: a first-time visitor reaches the canvas and places a piece without an OAuth redirect (instant guest identity, in-site pseudo + country modals); signing in with Google claims and keeps the guest's contributions under one identity; a single real-time path serves everyone, gated by an admission queue under load; the spectator read-path is retired.

Migration order under the single prod, no staging: A is pure addition (the spectator still cohabits), B puts the admission safety valve in place before C removes the CDN read-path. Each shipped on its own and left the app working.

### `auth-and-accounts`
- [x] Guest players (Chantier A): `POST /guest` mints a real User (`guest:true`, chosen unique pseudo + country, no email) plus a DB session, rate-limited per IP; the WS session gate is unchanged. See DECISIONS
- [x] Claim on sign-in (Chantier A): `POST /guest/claim` reattributes the guest's `cluster_merges` to the Google user, carries over pseudo/country, deletes the guest doc. See DECISIONS

### `frontend-shell`
- [x] Single "Play" entry (Chantier A): the landing CTA goes straight to `/play`; a guest is minted in-site or an existing session is reused. No spectator/contributor mode toggle remains in the UI
- [x] Options menu (Chantier A): a gear icon opens a modal (sync account, sign out, change pseudo, change country), replacing the "become a contributor" card. See DECISIONS

### `backend-realtime`
- [x] Admission queue (Chantier B): a global cap (`MPP_MAX_ACTIVE_CONNECTIONS`) on connections, a ticket queue (`POST /queue/ticket`, `GET /queue/status`) issuing TTL'd grants, the WS upgrade admitting `?grant=`. See DECISIONS
- [x] Retire the spectator read-path (Chantier C): `GET /keyframe` + `GET /events` and the `EventLog` are gone, the rate limiter repurposed as the public-landing guard, `KeyframePublisher` now holds a slim `BoardSnapshot`. Manual follow-up: rename `MPP_SPECTATOR_RATE_MAX`/`MPP_SPECTATOR_RATE_WINDOW_SEC` in the Coolify env if set (defaults unchanged). See DECISIONS
- [x] Fix the grab/disconnect hold-leak race, add a stale-hold sweep: a grabbed group id is reserved synchronously at dispatch, so a disconnect racing an in-flight grab always releases it; a periodic sweep force-releases any hold whose owner is gone for any other reason (crash, restart). See DECISIONS

### `frontend-canvas`
- [x] Remove the spectator transport (Chantier C): the canvas is WS-only; `landing`/`interested` moved onto the WS host. Manual follow-up: remove `VITE_SPECTATOR_BASE_URL` from the Cloudflare Pages env and retire the `snapshot.*` proxied hostname now that the backend stream is gone

### `shared-protocol`
- [x] Drop the spectator wire types (Chantier C): spectator-only types are gone, the minimap grid stays, `PROTOCOL_VERSION` bumped to 6 (asserted at the `hello` handshake)

---

## Backlog

Ideas worth keeping but not yet committed to a phase. Promote into a phase track when scope and timing are clear.

- **Dynamic max-zoom that grows with progress.** Cap zoom-out early and relax it as pieces are placed, to bound the visible piece count. A fixed 15% zoom floor already exists (see [play-zone hard limits](DECISIONS.md#2026-05-21-frontend-canvas-play-zone-hard-limits)); the progress-relative version is the open idea.
- **Coordinate HUD overlay.** Small overlay showing viewport position (XY, sector, zoom). Needs a "sector" concept first. Revisit at 1M when orientation becomes a real problem.
- **Firewall the origin to Cloudflare IP ranges.** Closes the last DDoS gap: the VPS is still directly reachable so the edge is bypassable and `CF-Connecting-IP` is spoofable. Steps in [DECISIONS topology](DECISIONS.md#2026-05-18-infra-deploy-alpha-topology).
