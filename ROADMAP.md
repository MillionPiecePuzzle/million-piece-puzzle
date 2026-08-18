# Roadmap

Six phases, eleven tracks. A phase is closed only when its exit criterion is met. Each task carries an exit criterion, not a description. Detail on non-obvious choices lives in [DECISIONS.md](DECISIONS.md); done tasks here are kept terse.

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

### `shared-protocol`
- [x] Protocol frozen at v6, breaking changes bump the version asserted at the `hello` handshake
- [x] `eventStartsAt` drives the landing countdown and the `/play` entry gate
- [x] Anti-programmatic-solving: seed-permuted wire ids, anchor-relative offsets, server-only seed

### `piece-generation`
- [x] 1 000 000 unique pieces validated (`npm run validate:generation`)

### `image-pipeline`
- [x] Piece borders baked into tiles at slice time
- [x] Gigapixel pipeline (Deep Zoom + per-piece AVIF) running end to end on R2

### `frontend-shell`
- [x] Landing, countdown, single Google auth modal, `/play` entry gate
- [x] Localized EN/FR/ES/DE
- [x] Dev-only Place/Reset/Complete controls off in prod (`MPP_DEV_ENABLED=0`, `VITE_DEV_BUTTONS=0`)

### `frontend-canvas`
- [x] Zoom-out LOD, viewport-driven texture streaming, chunked board build
- [x] Fixed z-order layers, evicted geometry cache, VRAM-bounded zoom-out
- [x] Per-tile piece cap on non-merging drops (8x solved density)
- [x] Single per-frame `reconcile()` as sole authority for cull/LOD/residency
- [x] Zoom in/out reuses resident nodes with no re-fetch at 1M

### `backend-realtime`
- [x] Viewport-sharded broadcasts (spatial index + cluster-AABB scoping)
- [x] Group index + partial-state resync on pan
- [x] Viewport-scoped initial state on join, no full board in `welcome`
- [x] Paced `region_state` resync, avoids the WS backpressure close

### `auth-and-accounts`
- [x] Auth.js with Google, per-IP login anti-abuse, Mongo profiles
- [x] 24h cooldown on pseudo/country changes

### `infra-deploy`
- [x] Production hardening: R2 backup sidecar, Cloudflare-proxied WS with heartbeat. Firewalling the origin to Cloudflare ranges stays the open DDoS gap (backlog)
- [x] Frontend moved to Cloudflare Pages, dropped from Coolify. Manual follow-up still outstanding: remove the unused `VITE_WS_URL`/`VITE_AUTH_BASE_URL`/`MPP_ALLOWED_HOSTS` from the old Coolify service env
- [x] Admin ops page (wipe, set event start, switch puzzle); confirmed live behind Basic auth

### `qa-and-load`
- [x] Load-test bots authenticated past the WS session gate, verified at 10 000
- [x] Soak test at target scale passes with no state corruption

### `legal`
- [x] Privacy policy, GDPR notes, license attributions published

### `complementary`
- [x] Interested counter, nationality onboarding with an international opt-out
- [x] Edge-pan navigation, sticky carry mode, minimap navigation
- [x] Activity feed, snap particle burst, brand icons, countdown labels

---

## Phase 3, Open Access (guest-first), CLOSED

**Exit criterion (met)**: a first-time visitor reaches the canvas and places a piece without an OAuth redirect (instant guest identity, in-site pseudo + country modals); signing in with Google claims and keeps the guest's contributions under one identity; a single real-time path serves everyone, gated by an admission queue under load; the spectator read-path is retired.

Shipped in 3 independent chantiers under the single prod, no staging: A added guests without touching anything else, B put the admission safety valve in place before C removed the CDN read-path. Confirmed 2026-08-05: the retired `snapshot.*` hostname now resolves to nothing.

### `auth-and-accounts`
- [x] Guest players: `POST /guest` mints a real User, rate-limited per IP
- [x] Claim on sign-in: `POST /guest/claim` reattributes guest contributions to the Google user

### `frontend-shell`
- [x] Single "Play" entry point, no spectator/contributor mode toggle
- [x] Options menu (sync account, sign out, change pseudo/country)

### `backend-realtime`
- [x] Admission queue: global connection cap, ticket + poll, TTL'd grants
- [x] Spectator read-path retired (`GET /keyframe`/`GET /events`/`EventLog` gone)
- [x] Grab/disconnect hold-leak race fixed, stale-hold sweep added
- [x] Keyframe cadence moved off full-board scans onto an incrementally-maintained minimap grid

### `frontend-canvas`
- [x] Spectator transport removed, canvas is WS-only

### `shared-protocol`
- [x] Spectator wire types dropped, `PROTOCOL_VERSION` bumped to 6

---

## Phase 4, Player Diagnostics, CLOSED

**Exit criterion (met)**: a player can open a tile-by-tile load-state view of the whole play zone with a compact resident-memory readout from the minimap.

### `frontend-canvas`
- [x] Minimap detail modal: whole-play-zone tile grid (not loaded / loading / loaded) plus a compact memory readout, opened from the minimap via an expand button. See DECISIONS

---

## Phase 5, Locked-Region Scale, CLOSED

**Exit criterion (met)**: a board with ~995 000 locked pieces (no single cluster larger than the hard cap) stays fluid: locked pieces render from server-composited per-cell tiles instead of per-piece fetches, with piece borders preserved; resident client memory stays within the existing budget; no unlocked cluster exceeds `MPP_CLUSTER_PIECE_CAP`.

A locked piece has no gameplay reason to keep a `groupId` once anchored, but the old merge logic kept folding newly-anchored clusters into one ever-growing locked group. Near completion this produced a single cluster of hundreds of thousands of members, and the client's hydration path fetched a whole group's member textures in one unbounded batch: an unbounded-load, likely-crash risk this phase closed before it was ever hit live. Delivered in 4 independently shippable, separately testable stages, since this touches the merge/anchor path (permanent, no undo) and the wire protocol.

### Stage 1 (backend only): locked pieces stop being a group
- [x] `locked` moves from the group hash to the piece hash; an anchored cluster's group is deleted rather than merged into a growing locked group
- [x] `detectSnap` checks piece-level `locked` directly instead of resolving through `piece.groupId -> group.locked`
- [x] Hard cap `MPP_CLUSTER_PIECE_CAP` (default 20 000) on unlocked-unlocked merges; merging into a locked neighbor is exempt
- [x] `stateInvariants.ts`'s locked check rewritten as a direct Mongo-replay-vs-Redis piece-flag comparison

### Stage 2: locked pieces reach the client, decoupled from GroupNode
- [x] `SSnap`/`region_state` carry locked piece ids per cell, decoupled from `GroupNode`/`hydrateGroup`
- [x] `seed-lock-scenario.ts` rewritten for the new model; crash risk verified closed at ~995 000-piece scale

### Stage 3: server-composited locked tiles ("see it all at once")
- [x] Incremental per-cell tile compositing (sharp) on a debounced dirty-cell queue, cached and versioned in R2; compositing live in prod
- [x] Frontend consumes the server-composited tile when available, falls back to Stage 2's per-piece rendering otherwise

### Stage 4: expose composites over the wire, retire per-piece locked hydration
- [x] `region_state`/`cell_composite` report and push live composites over the wire
- [x] `CompositeTileLayer` renders every covering composite tile with a byte-weighted eviction budget; the per-piece locked fallback (`hydrateLockedPiece`/`lockedHydrateQueue`/`lockedResident`) is removed entirely, superseded in Phase 6 by `DziRevealLayer`

---

## Phase 6, Real Photo, CLOSED

**Exit criterion (met)**: a real gigapixel source image exists (NASA Blue Marble main image, a combined library of CC0/public-domain Wikimedia Commons and manually-downloaded Unsplash nature and animal tile photos, assembled as a photo mosaic), producible end to end by three dev scripts, and verified to slice cleanly through the existing, unchanged `slice-image.ts` at both a small test scale and the real production scale (grid dimensions matching the source image's own aspect ratio; the puzzle grid does not have to be square).

### `image-pipeline`
- [x] `fetch-tile-images.ts`: downloads a local library of a few hundred to ~1000 CC0/public-domain nature and animal photos from Wikimedia Commons, with a provenance manifest and idempotent resume. See DECISIONS.
- [x] `ingest-unsplash-tiles.ts`: folds manually-downloaded Unsplash photos into the same tile manifest, since Unsplash's own API guidelines expect a human choosing each download rather than an automated fetch. See DECISIONS.
- [x] `build-mosaic.ts`: assembles the main image and the combined tile library into one gigapixel BigTIFF photo mosaic, using the same banded chunk/strip streaming strategy as `synthetic-source.ts`. See DECISIONS.
- [x] Real production mosaic generated: full Blue Marble main image and the ~10 750-photo combined tile library, 1000x1000 grid at 120px/piece (14.4 GP), via Docker (Windows libvips segfaults past ~5 GP regardless of content; see DECISIONS).
- [x] Full-scale run verified: the real mosaic slices cleanly through the unchanged `slice-image.ts` at 1000x1000, 120px/piece; the resulting `earth-mosaic` puzzle assets are uploaded to R2. See DECISIONS.

### `frontend-canvas`
- [x] `DziRevealLayer` promoted to the only locked-piece rendering path, no `?dziReveal=1` flag: the reference DZI pyramid revealed through a server-baked per-piece silhouette mask (reusing CellCompositor) plus a seam overlay, replacing the flat-rectangle `CompositeTileLayer`. See DECISIONS.

### `backend-realtime`
- [x] Retire the server-side full-photo composite tier: `CellCompositor` stops fetching piece tiles and baking/uploading the photo AVIF alongside the mask/seam tiers, since `DziRevealLayer` never fetches it; existing photo objects on R2 are purged. See DECISIONS.

### `infra-deploy`
- [x] Prod switched to serve `earth-mosaic`: seed added to `MPP_ADMIN_PUZZLES` in the Coolify env, cut over via the admin ops page (full wipe, then switch-puzzle). See DECISIONS.

---

## Phase 7, Self-Hosted Analytics

**Exit criterion**: Umami, self-hosted alongside the other backend services, tracks unique visitors, average visit duration, country, referrer, and new-vs-returning for the canvas; `/play` is tracked as a page distinct from `/`; the privacy policy discloses it.

### `infra-deploy`
- [x] Umami + Postgres deployed (Docker Compose, Traefik labels mirroring the existing app, joined to the shared `coolify` network). See DECISIONS.
- [x] DNS for the analytics host live, TLS and the dashboard verified reachable end to end
- [ ] Merged to `main` and deployed; a real pageview confirmed in the dashboard

### `frontend-shell`
- [x] Tracking script loads from `VITE_UMAMI_URL`/`VITE_UMAMI_WEBSITE_ID`, unset (and therefore inert) outside prod; Umami's own automatic SPA route tracking distinguishes `/play` from `/` with no extra code
- [x] Operator self-exclusion link on the admin page

### `legal`
- [x] Privacy policy discloses the self-hosted analytics and its hashing mechanism, EN source translated to FR/ES/DE
- [x] Image credits (Unsplash source, mosaic-algorithm inspiration) added to the Legal page, linked from the reference image caption, EN source translated to FR/ES/DE

---

## Phase 8, Search Discoverability, CLOSED

**Exit criterion (met)**: the production site is crawlable and indexable with accurate metadata; `robots.txt` and `sitemap.xml` are live; every route corrects its own title, description, and canonical instead of inheriting the landing page's.

### `frontend-shell`
- [x] `robots.txt` + `sitemap.xml` covering the public routes (`/`, `/privacy`, `/legal`)
- [x] `index.html`: keyword-rich title/description, canonical, Open Graph, Twitter Card, `WebApplication` JSON-LD structured data
- [x] Per-route title/description/canonical/robots correction (`src/seo.ts`), since a single static canonical would otherwise mark `/privacy` and `/legal` as duplicates of `/`

---

## Presence Indicator

- [x] Minimap header shows a live connected-player count next to a flat (non-animated) status dot, sourced from the existing join/leave broadcast: `SJoin`/`SLeave`/`SWelcome` carry `count`, `Hub.clientCount()` feeds it, `frontend-canvas` renders it next to "Overview". No new WS message, no added broadcast fan-out. Peer positions on the minimap were evaluated and dropped: see DECISIONS.

---

## Phase 9, Pre-Launch Load Realism

**Exit criterion**: a load-test run against prod, with a portion of bots clustered, is visually confirmed in a real browser: labeled peer cursors glide and drag pieces near each other in one viewport, with a clean PASS verdict and a clean state-corruption validator pass afterward.

### `qa-and-load`
- [~] Bots discover pieces empirically and report a shared hotspot; `--cluster-fraction` biases a portion of bots' viewports toward it instead of a fully random one
- [~] Drag targets sample from the bot's own current viewport instead of the whole play zone
- [~] Bot cursor eases toward its next grab target and snaps to the live drag position instead of teleporting randomly every tick; seeded sessions carry a `pseudo` so bots render a name tag like any other player
- [~] `--cluster-fraction` CLI flag wired end to end, README and DECISIONS updated

---

## Backlog

Ideas worth keeping but not yet committed to a phase. Promote into a phase track when scope and timing are clear.

- **Locale-prefixed URLs for search.** Phase 8's SEO metadata is English-only because locale is chosen client-side (`localStorage`/browser language) with no URL segmentation, so a search engine can only index one language version of `/`. Ranking for non-English queries (e.g. French "puzzle le plus grand") needs its own crawlable URL per locale (`/fr/`, `/es/`, `/de/`), native-language meta strings, hreflang alternates, and rewiring every internal link (language switcher, router pushes) to a locale-aware path: a router restructuring, not a metadata tweak. See [DECISIONS](DECISIONS.md#2026-08-17-frontend-shell-seo-metadata-is-english-only-corrected-per-route-in-js-rather-than-per-locale).
- **Dynamic max-zoom that grows with progress.** Cap zoom-out early and relax it as pieces are placed, to bound the visible piece count. A fixed 15% zoom floor already exists (see [play-zone hard limits](DECISIONS.md#2026-05-21-frontend-canvas-play-zone-hard-limits)); the progress-relative version is the open idea.
- **Coordinate HUD overlay.** Small overlay showing viewport position (XY, sector, zoom). Needs a "sector" concept first. Revisit at 1M when orientation becomes a real problem.
- **Firewall the origin to Cloudflare IP ranges.** Closes the last DDoS gap: the VPS is still directly reachable so the edge is bypassable and `CF-Connecting-IP` is spoofable. Steps in [DECISIONS topology](DECISIONS.md#2026-05-18-infra-deploy-alpha-topology).
