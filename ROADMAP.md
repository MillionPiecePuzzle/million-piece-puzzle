# Roadmap

Three phases, eleven tracks. A phase is closed only when its exit criterion is met. Each task carries an exit criterion, not a description. Detail on non-obvious choices lives in [DECISIONS.md](DECISIONS.md); done tasks here are kept terse.

Statuses: `[ ]` not started, `[~]` in progress, `[x]` done.

## Tracks

1. `shared-protocol`: shared TS types, WS messages, piece and user schemas
2. `piece-generation`: Bezier silhouettes, snap geometry, piece types
3. `image-pipeline`: libvips processing, Deep Zoom tiles, per-piece AVIF, R2 upload
4. `frontend-shell`: landing, routing, spectator/contributor modes, auth modal
5. `frontend-canvas`: PixiJS rendering, OpenSeadragon, drag/drop, LOD, culling
6. `backend-realtime`: WS server, drag/drop/snap logic, Redis state, Mongo logs, CDN snapshots
7. `auth-and-accounts`: Auth.js (Google), pseudo onboarding, sessions, login anti-abuse
8. `infra-deploy`: Docker, Coolify, Hetzner, Cloudflare (Pages, R2, CDN, DNS)
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
- [ ] Protocol frozen at v1, breaking changes go through version bump
- [x] `eventStartsAt` (unix ms) in `welcome` to sync the cascade trigger (from `MPP_EVENT_STARTS_AT`, default 0 = no scheduled start), mirrored into the spectator `Snapshot`
- [x] Anti-programmatic-solving: seed-permuted wire ids, anchor-relative member offsets, server-only seed. A client can no longer reconstruct adjacency. `PROTOCOL_VERSION` 4, `SPECTATOR_FORMAT_VERSION` 2. Deploy step re-uploads R2 under wire-id paths and sets `MPP_GENERATION_SEED`. See DECISIONS: anti-programmatic-solving

### `piece-generation`
- [x] Generation pipeline produces and validates 1 000 000 unique pieces: streaming `validateGeneration` (`npm run validate:generation`, ~1.8s) checks ids, offsets, edge params, neighbour agreement, and per-seed edge uniqueness. See DECISIONS: edge uniqueness validated per-seed

### `image-pipeline`
- [x] Piece border baked into the tile: slicer strokes the silhouette over the alpha-cut window before AVIF encode (`borderBaked: true`), frontend drops its render-time stroke. See DECISIONS: pre-cut alpha masks baked server-side
- [x] Gigapixel source processed end to end (Deep Zoom + per-piece alpha-cut AVIF) and hosted on R2. Slicer reads the source via libvips random access (RAM-bounded); a procedural synthetic source (`npm run materialize`) writes a real tiled BigTIFF the slicer treats like a final photo. Uploading the final gigapixel asset is the deploy step. See DECISIONS: pre-cut alpha masks baked server-side, synthetic source

### `frontend-shell`
- [x] Final landing copy + single CTA gated on event start ("I'm interested" until launch, flips to "Enter the canvas"); closed-alpha passcode removed. Contributor onboarding delivered under `auth-and-accounts`
- [x] Countdown timer on landing (DD:HH:MM:SS, `useCountdown` off `GET /landing`), polished "Launching soon" placeholder when no date set
- [x] Auth modal: single "Continue with Google" action running the Auth.js SPA sign-in, return flow forces pseudo then nationality. Google-only by design. Delivered under `auth-and-accounts`
- [x] `/play` sealed before a scheduled event: `beforeEnter` guard reads `eventStartsAt` from the shared `GET /landing` load and redirects to landing while a real start is future; unset/transient-failure leaves it open. See DECISIONS: /play entry gate mirrors the scheduled start

### `frontend-canvas`
- [x] Zoom-out LOD scales to 1M: client-baked tile cache, cull and bake bounded by the visible window via a spatial index. Full 1M runtime verification folded into "smooth at 1M"
- [x] Viewport-driven texture streaming: per-piece AVIF and nodes hydrated on demand within a viewport ring, freed past a keep ring. See DECISIONS: viewport-driven texture streaming
- [x] Chunked board build: post-download `build()` runs in time-budgeted yielding passes behind a `build` status phase, per-piece geometry generated lazily. Loading cover walks connect -> manifest -> build -> textures -> ready with no frozen gap. See DECISIONS: chunked board build
- [x] Rendering stays smooth on commodity hardware at 1M: fixed z-order layer containers (no `sortableChildren`), geometry cache evicted on dehydrate, deep zoom-out VRAM bounded by freeing covered idle clusters. End-to-end 1M smoke is the `qa-and-load` soak test. See DECISIONS: z-order layers, hot-tile residency
- [x] Per-tile loading indicator: pulsing badge over viewport cells not yet on screen (three states by zoom band), `region_state` coverage rect distinguishes a pending region from an empty one
- [x] Per-tile piece cap: a non-merging drop onto a cell already at `MPP_TILE_PIECE_CAP_MULTIPLIER` (default 8) times solved density is rejected, cluster bounces back via `rollback` with a "tile_full" toast. Merges and anchors exempt. See DECISIONS: per-tile piece cap
- [x] Consolidate the LOD/baking/streaming reconcile: a single per-frame `reconcile()` is the sole authority for cull, LOD visibility, residency, dirty-flush and loading cells; event handlers only mutate the model and record dirty rects. Removes the scattered per-handler dirty/visibility/residency calls and the per-frame glide re-bake churn. Extracted pure decisions (dirty-cell coalescing, residency, loading-cell predicate) are unit-tested. See DECISIONS: frustum culling and tiled zoom-out LOD
- [x] Zoom in/out stops reloading the window: covered-cold per-piece nodes are freed lazily under an LRU `RESIDENT_PIECE_BUDGET`, not eagerly, so under the budget (the alpha board) a zoom cycle re-uses resident nodes with no re-fetch while a 1M deep zoom-out still converges on the budget; `reconcile` crosses the LOD band before the residency pass so a zoom-in re-hydrates the now-uncovered clusters the same frame, with no mouse move. See DECISIONS: hot-tile residency

### `backend-realtime`
- [x] Viewport sharding for broadcasts: spatial broadcast index + cluster-AABB scoping. See DECISIONS: spatial broadcast index
- [x] Group index + partial-state resync on pan: `handleViewport` resyncs newly entered cells via `region_state` (an ordering guard skips held/just-dropped groups). See DECISIONS: group spatial index and pan resync
- [x] Viewport-scoped initial state on join: `welcome` carries no board (PROTOCOL_VERSION 3); groups stream in per viewport via a `region_state` construction stream from the `GroupIndex`. Minimap from a server-computed density grid plus a live overlay of known regions
- [x] Spectator stream scales to 1M: CDN-cached keyframe + immutable wall-clock event-log windows (`GET /keyframe` + `GET /events/<t0>`), client tails behind live and interpolates. See DECISIONS: spectator keyframe and event-log
- [x] Anti-abuse for public traffic: spectator stream behind `makeSpectatorGuard` (Redis per-IP fixed window, default 120/60s fail-open) + query-string rejection. See DECISIONS: spectator stream anti-abuse

### `auth-and-accounts`
- [x] Auth.js wired with the Google provider
- [x] Login anti-abuse: per-IP rate limit on auth routes + per-IP account-creation cap
- [x] User profiles stored in Mongo, pseudo shown for snap attribution

### `infra-deploy`
- [x] Production hardening: backups (`backup` sidecar pushes gzipped `mongodump` + Redis RDB to private `mpp-backups` R2 every 6h, keep-3), secrets stay in the Coolify env, `ws.*` Cloudflare-proxied with an Origin CA cert (Full strict) + 30s WS heartbeat. Manual infra done and verified. Firewalling the origin to Cloudflare ranges stays the open DDoS gap (backlog). See DECISIONS: scheduled backups, alpha topology
- [x] Frontend dropped from the Coolify deploy: `docker-compose.yml` (deployed by Coolify) no longer defines the Vite dev `frontend` service; it lives in `docker-compose.override.yml` for local dev only, since prod `app.*` is Cloudflare Pages. Manual follow-up: remove the now-unused `VITE_WS_URL`/`VITE_AUTH_BASE_URL`/`MPP_ALLOWED_HOSTS` from the Coolify service env, then redeploy so the dev frontend container stops.

### `qa-and-load`
- [x] Load-test bots authenticate past the WS session gate: harness seeds a disposable user + database session per bot in Mongo and sends the matching cookie; bot brought to protocol v3. Verified at 10 000 (anonymous rejected, ~160 drag/s sustained, clean teardown). See DECISIONS: harness seeds sessions by direct Mongo write
- [ ] Soak test with simulated traffic at target scale passes without state corruption

### `legal`
- [x] Privacy policy published: public `/privacy` page, linked from the landing footer
- [x] GDPR notes folded into `/privacy` (data collected, retention, access/erasure/portability, Discord contact); `/legal` notice page ships alongside
- [x] License attributions: Open-source licenses section on `/legal` (Vue, Vue Router, PixiJS, OpenSeadragon). Terms of use intentionally dropped (non-commercial, no chat, permanent pieces)

### `complementary`
- [x] Landing interested counter: opt-in button registers the visitor and shows the public count, deduped per IP via a hashed-IP Redis set. `GET /landing` + `POST /interested`. See DECISIONS: interested counter dedup by hashed-IP set
- [x] Contributor nationality: required onboarding step after the pseudo, stored on the profile; leaderboard avatar is the contributor's round country flag
- [x] Edge-pan navigation: during a press-drag the camera scrolls toward a canvas edge when the pointer rests in an edge band (RTS-style), driven by the Pixi ticker, suppressed during a manual background pan
- [x] Sticky carry mode: double-click sticks a cluster to the cursor (move + edge-pan/zoom with no button held), double-click drops, Escape returns it, 30s idle timeout. See DECISIONS: sticky carry mode
- [x] Sticky-carry cursor offset: a carried cluster floats to the upper-right of the cursor with its bounding-box corner held a constant screen-space gap clear of the pointer (applied the instant it is grabbed), so the whole cluster stays off the cursor at any zoom; pan (drag) and zoom (wheel) work mid-carry as with an empty hand, and a double-click drop lands the cluster at the cursor. Press-drag is unchanged (piece under the cursor, no offset)
- [x] Add a global timer on the play page
- [x] More info in the activity panel: snap (loose merge) vs place (anchored), each as a single piece or an N-piece cluster, driven by `droppedSize`/`mergedSize` on the snap event. See DECISIONS: activity feed event types
- [x] Landing reflects the event lifecycle: countdown before the start, live progress (locked/total bar) plus an activity + leaderboard two-column block during, and a completed recap (COMPLETED, date, event duration, full-width final leaderboard) after. Driven by `GET /landing` extended with `status`/`progress`/`leaderboard`/`activity`/`completion`; live figures come from the in-memory keyframe snapshot (no full-board fetch), the completed span from a `puzzleId_at`-indexed first/last merge lookup
- [x] Snap particle burst: a small spark burst radiates from each piece the instant it locks (snap or anchor), reusing the snap bump/flash path on the Pixi ticker, capped per snap event so a large cluster anchor cannot spawn unbounded particles
- [x] Brand mark as favicon and Discord icon: cream-tiled SVG favicon + apple-touch PNG wired in index.html, plus a 512px Discord server-icon PNG, all generated from the BrandMark glyph via `npm run icons`

---

## Backlog

Ideas worth keeping but not yet committed to a phase. Promote into a phase track when scope and timing are clear.

- **Dynamic max-zoom that grows with progress.** Cap zoom-out early and relax it as pieces are placed, to bound the visible piece count. A fixed 15% zoom floor already exists (see [play-zone hard limits](DECISIONS.md#2026-05-21-frontend-canvas-play-zone-hard-limits)); the progress-relative version is the open idea.
- **Coordinate HUD overlay.** Small overlay showing viewport position (XY, sector, zoom). Needs a "sector" concept first. Revisit at 1M when orientation becomes a real problem.
- **Firewall the origin to Cloudflare IP ranges.** Closes the last DDoS gap: the VPS is still directly reachable so the edge is bypassable and `CF-Connecting-IP` is spoofable. Hetzner Cloud Firewall allowing 80/443 from Cloudflare ranges + admin IP, 22 from admin IP, at the network edge. Steps in [DECISIONS topology](DECISIONS.md#2026-05-18-infra-deploy-alpha-topology).
- **Reword the legal and policy pages.**
