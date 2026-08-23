# Roadmap

Five phases, eleven tracks, all closed: the project is complete. A phase is closed only when its exit criterion is met. Each task carries an exit criterion, not a description. Detail on non-obvious choices lives in [DECISIONS.md](DECISIONS.md); done tasks here are kept terse.

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
- [x] Protocol frozen at v10, breaking changes bump the version asserted at the `hello` handshake
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

## Phase 4-9, Launch Readiness, CLOSED

**Exit criterion (met)**: the puzzle serves the real photo mosaic at full production scale; locked pieces render from server-composited tiles with resident memory inside budget past 995 000 locked pieces and no unlocked cluster exceeding `MPP_CLUSTER_PIECE_CAP`; player diagnostics, self-hosted analytics, and search discoverability are all live in prod; a clustered load-test run against prod passes a clean visual and state-corruption check.

### `image-pipeline`
- [x] `fetch-tile-images.ts` / `ingest-unsplash-tiles.ts` / `build-mosaic.ts`: three scripts assemble a gigapixel BigTIFF photo mosaic end to end (banded chunk/strip streaming, same strategy as `synthetic-source.ts`) from the NASA Blue Marble main image plus a combined CC0/Wikimedia and manually-downloaded Unsplash tile library, with a provenance manifest and idempotent resume. See DECISIONS
- [x] Real production mosaic generated (full Blue Marble image, ~10 750-photo tile library, 1000x1000 grid at 120px/piece, 14.4 GP, via Docker since Windows libvips segfaults past ~5 GP) and verified slicing cleanly through the unchanged `slice-image.ts`; `earth-mosaic` assets uploaded to R2. See DECISIONS

### `frontend-shell`
- [x] `robots.txt` + `sitemap.xml` covering the public routes (`/`, `/privacy`, `/legal`); `index.html` keyword-rich title/description, canonical, Open Graph, Twitter Card, `WebApplication` JSON-LD
- [x] Per-route title/description/canonical/robots correction (`src/seo.ts`), since a single static canonical would otherwise mark `/privacy` and `/legal` as duplicates of `/`
- [x] Umami tracking script (`VITE_UMAMI_URL`/`VITE_UMAMI_WEBSITE_ID`), inert outside prod; Umami's own automatic SPA route tracking distinguishes `/play` from `/` with no extra code; operator self-exclusion link on the admin page

### `frontend-canvas`
- [x] Minimap detail modal: whole-play-zone tile grid (not loaded / loading / loaded) plus a compact memory readout, opened from the minimap via an expand button. See DECISIONS
- [x] Locked pieces render from `DziRevealLayer`: the reference DZI pyramid revealed through a server-baked per-piece silhouette mask plus a seam overlay, decoupled from `GroupNode`/`hydrateGroup`
- [x] Minimap header shows a live connected-player count next to a status dot, sourced from the existing join/leave broadcast (`SJoin`/`SLeave`/`SWelcome` `count`, `Hub.clientCount()`), no new WS message. See DECISIONS

### `backend-realtime`
- [x] Locked pieces live on the piece hash, not a group: `detectSnap` checks piece-level `locked` directly, and an anchored cluster's group is deleted rather than merged into one ever-growing locked group, closing an unbounded-hydration crash risk before it was ever hit live; verified at ~995 000-piece scale. See DECISIONS
- [x] Hard cap `MPP_CLUSTER_PIECE_CAP` (20 000) on unlocked-unlocked merges, merging into a locked neighbor exempt; `stateInvariants.ts` validates `locked` via a direct Mongo-replay-vs-Redis piece-flag comparison
- [x] Locked-region state reaches clients as incremental, server-composited per-cell tiles (sharp, debounced dirty-cell queue, cached/versioned in R2, pushed live over `region_state`/`cell_composite`), not per-piece fetches
- [x] `CellCompositor`'s photo-tier retired: `DziRevealLayer` renders straight from the DZI pyramid and never fetches it
- [x] A board whose stored `generationSeed` differs from the one the server loads is relabeled onto the loaded seed at boot (crash-resumable, refuses anything already merged or locked) instead of being served unplayable; prod relabeled 2026-08-23 with the 4 618 player-moved pieces carried over, and the first lock landed minutes later. See DECISIONS

### `auth-and-accounts`
- [x] Pseudo and country onboarding steps independently skippable (a Skip control in place of the header close button, since neither step is otherwise dismissible during onboarding); skipping the pseudo step mints a unique "Guest #XXXX" pseudo (4 random alphanumeric characters), skipping the country step sets the international nationality. Menu-triggered edit modals are unchanged, already dismissible. See DECISIONS

### `infra-deploy`
- [x] Prod switched to serve `earth-mosaic`: seed added to `MPP_ADMIN_PUZZLES` in the Coolify env, cut over via the admin ops page (full wipe, then switch-puzzle). See DECISIONS
- [x] Umami + Postgres deployed (Docker Compose, Traefik labels mirroring the app, shared `coolify` network), DNS/TLS live, merged to `main` and deployed with a confirmed real pageview in the dashboard. See DECISIONS

### `qa-and-load`
- [x] Load-test bots discover pieces empirically and cluster a portion of viewports toward a shared hotspot (`--cluster-fraction`, wired end to end); drag targets sample from the bot's own current viewport; bot cursor eases toward its next grab target and snaps to the live drag position, with a `pseudo` name tag on seeded sessions. See DECISIONS
- [x] Clustered run against prod visually confirmed: labeled peer cursors glide and drag near each other in one viewport, clean PASS verdict, clean state-corruption validator pass

### `legal`
- [x] Privacy policy discloses the self-hosted analytics and its hashing mechanism; image credits (Unsplash source, mosaic-algorithm inspiration) added to the Legal page, linked from the reference image caption. Both EN source, translated to FR/ES/DE

---

## Backlog

Ideas and open fixes worth keeping but not yet committed to a phase. Promote into a phase track when scope and timing are clear.

- **Locale-prefixed URLs for search.** The SEO metadata work (Phase 4-9) is English-only because locale is chosen client-side (`localStorage`/browser language) with no URL segmentation, so a search engine can only index one language version of `/`. Ranking for non-English queries (e.g. French "puzzle le plus grand") needs its own crawlable URL per locale (`/fr/`, `/es/`, `/de/`), native-language meta strings, hreflang alternates, and rewiring every internal link (language switcher, router pushes) to a locale-aware path: a router restructuring, not a metadata tweak. See [DECISIONS](DECISIONS.md#2026-08-17-frontend-shell-seo-metadata-is-english-only-corrected-per-route-in-js-rather-than-per-locale).
- **Dynamic max-zoom that grows with progress.** Cap zoom-out early and relax it as pieces are placed, to bound the visible piece count. A fixed 15% zoom floor already exists (see [play-zone hard limits](DECISIONS.md#2026-05-21-frontend-canvas-play-zone-hard-limits)); the progress-relative version is the open idea.
- **Coordinate HUD overlay.** Small overlay showing viewport position (XY, sector, zoom). Needs a "sector" concept first. Revisit at 1M when orientation becomes a real problem.
- **Firewall the origin to Cloudflare IP ranges.** Closes the last DDoS gap: the VPS is still directly reachable so the edge is bypassable and `CF-Connecting-IP` is spoofable. Steps in [DECISIONS topology](DECISIONS.md#2026-05-18-infra-deploy-alpha-topology).
- **Persisted player display settings.** Prerequisite for the reference underlay, the HUD toggles, and any locked-piece rendering option below. No player preference is persisted client-side today (`localStorage` carries only the guest claim token, the locale, and the landing interested flag) and `OptionsModal.vue` holds account actions only, so a settings store and a display section in the menu both have to exist first.
- **Reference image underlay in the canvas.** The source image showing faintly under the pieces, toggleable, so it is obvious where a piece belongs. Cheaper than it looks: `DziRevealLayer` already streams a full-viewport DZI tile layer every frame and only masks it to locked silhouettes, so the underlay is that same layer unmasked at low alpha beneath `lockedPiecesLayer`. Making the board easier is accepted (it is close to infeasible by hand, and other jigsaw sites offer the same aid), but locked pieces have to stay unmistakably distinct from the ghost behind them: stopping the underlay at the locked frontier is not enough on its own, locked content needs its own rendering treatment, which makes the item below a prerequisite rather than a companion.
- **Locked vs unlocked piece differentiation.** Locked and unlocked content already render through separate layers (`DziRevealLayer` against `unlockedLayer`), so a per-layer treatment (contrast, saturation, seam emphasis, an outline on free pieces) costs nothing per piece. Zoom-out LOD bakes tiles, so a per-piece effect such as a drop shadow will not survive the LOD band while a per-layer color treatment will. Direction still open: make free pieces stand out, or make locked content recede.
- **Toggleable HUD windows.** Each panel individually hidable, driven by mobile where the four panels leave little room for the board. This is the mobile navigation the responsive pass already named as its own revisit condition (see [DECISIONS](DECISIONS.md#2026-08-06-frontend-shell-responsive-hud-shrinks-panels-instead-of-hiding-them)): panels collapse into a real control surface instead of shrinking further. On a phone an always-visible icon bar beats a setting buried in a modal, and that bar competes for the same screen edge as the flags below, so the two want designing together.
- **Personal viewport flags.** Client-side bookmarks: drop a flag at the current viewport position, flags listed along the HUD, clicking one teleports the camera there instantly, so pieces can be sorted in one place while they are collected elsewhere. Strictly personal, no protocol change, and the camera teleport already exists behind minimap navigation. Open: `localStorage` (per browser) or account-backed (follows the player across devices), maximum count, how a flag is placed and named, and whether flags also render as minimap markers.
- **Shareable viewport deep link.** `/play` accepting a position and zoom in the query string, so a spot on the board can be linked in Discord ("help here") or bookmarked outside the app. Sibling of the flags above and the natural way to share one. No secret is exposed: board coordinates are already client-visible, unlike the seed-permuted piece ids.
- **Live leaderboard on merges, not only on locks.** Standings reach clients on an anchoring lock and on the per-client send at join, so pieces scored by a merge that does not lock only appear after a page reload. The tracker is already correct (`recordDrop` runs on every merge, only the broadcast is gated on `lockedDelta > 0` in `handlers.ts`). Two things to solve when lifting that gate: the payload is the top 100 with pseudo and country broadcast to everyone, so per-merge sends need coalescing; and a player ranked outside the top 100 never receives their own row, so their own live count needs a personal rank/count field rather than a bigger broadcast.
- **Tips & tricks section, with leaderboard scoring explained.** A help section in the menu, plus an info control on the leaderboard itself stating the rule (one point per piece, credited to the first merge that moved it, see [DECISIONS](DECISIONS.md#2026-05-21-backend-realtime-leaderboard-scoring)). Cheap in code; the real cost is writing the content and translating it to the four locales.
- **Static maintenance page.** A standalone page to put in front of the site during a deliberate pause or an outage, ready before it is needed rather than written under pressure. Open: where it is served from and how it is switched on and off, given the frontend is on Cloudflare Pages and keeps serving the app even when the VPS backend is down.
- **Per-piece attribution.** Who placed a given piece, and when, surfaced on a locked piece in the canvas. The data model already answers it with no new storage (the first `ClusterMerge` by `at` whose `droppedPieceIds` contains the piece), so the work is a lookup route, the matching index, and the UI affordance. Pairs with the leaderboard explainer: it makes the scoring rule visible on the board itself.
- **Timelapse.** Replay the board's assembly by walking `ClusterMerge` in `at` order, geometry reconstructed from `generationSeed`. Designed for since the start, never built, and a project in its own right rather than a feature to slip into another chantier. The obvious payoff is shareable footage of a months-long build.
- **Fix: no confirmation after syncing a guest account with Google.** Reported live: the sync entry in the options menu gives no feedback once the sign-in completes and still reads as actionable, so the player cannot tell the account is now permanent. Wanted: an explicit synced state (green check, the linked identity shown) in place of the action. Diagnose first, since `OptionsModal.vue` already gates the entry on `user.guest` and a Google document maps to `guest: false` in `mongo.ts`: if the entry really is still actionable after a successful claim, the session state is wrong and the missing indicator is only the visible half. Either way the menu shows no account identity at all today.
