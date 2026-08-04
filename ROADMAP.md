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
- [x] Protocol frozen at v6 before public launch (bumped 4->5->6 for activity-feed sizes and the spectator drop); breaking changes go through a version bump asserted at the `hello` handshake. See DECISIONS
- [x] `eventStartsAt` (unix ms) in `welcome` drives the landing countdown and the `/play` entry gate (`MPP_EVENT_STARTS_AT`, default 0 = no scheduled start)
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
- [x] Dev-only Place/Reset/Complete controls off in prod: `MPP_DEV_ENABLED=0` (server Dockerfile), `VITE_DEV_BUTTONS=0` (frontend `.env.production`); local dev keeps both via `docker-compose.override.yml`. See DECISIONS

### `frontend-canvas`
- [x] Zoom-out LOD scales to 1M via a client-baked tile cache, cull and bake bounded by the visible window through a spatial index
- [x] Viewport-driven texture streaming: per-piece textures and nodes hydrate on demand within a viewport ring, freed past a keep ring. See DECISIONS
- [x] Chunked, time-budgeted board build behind a `build` loading phase, per-piece geometry lazy; no frozen gap. See DECISIONS
- [x] Smooth at 1M: fixed z-order layers (no `sortableChildren`), evicted geometry cache, deep zoom-out VRAM bounded by freeing covered idle clusters. See DECISIONS
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
- [x] International opt-out in the nationality picker: a pinned, i18n-labeled choice using the existing `un` globe flag asset, no real country required. See DECISIONS
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
- [x] Stop the keyframe cadence from scanning the whole board: `KeyframePublisher`'s 5-minute tick read every piece and group via two full-board Redis pipelines, starving concurrent gameplay and blocking the WS dispatch loop for its duration. The minimap density grid is now maintained incrementally (`MinimapGridTracker`, updated on every drop/merge), with a full recompute only at boot/reset/force-complete and a slow defense-in-depth resync. Verified with a 300-step randomized differential test against a from-scratch recompute. See DECISIONS

### `frontend-canvas`
- [x] Remove the spectator transport (Chantier C): the canvas is WS-only; `landing`/`interested` moved onto the WS host. Manual follow-up: remove `VITE_SPECTATOR_BASE_URL` from the Cloudflare Pages env and retire the `snapshot.*` proxied hostname and its Cache Rule now that the backend stream is gone

### `shared-protocol`
- [x] Drop the spectator wire types (Chantier C): spectator-only types are gone, the minimap grid stays, `PROTOCOL_VERSION` bumped to 6 (asserted at the `hello` handshake)

---

## Phase 4, Player Diagnostics, CLOSED

**Exit criterion (met)**: a player can open a tile-by-tile load-state view of the whole play zone with a compact resident-memory readout from the minimap.

### `frontend-canvas`
- [x] Minimap detail modal: whole-play-zone tile grid (not loaded / loading / loaded) plus a compact memory readout, opened from the minimap via an expand button. See DECISIONS

---

## Phase 5, Locked-Region Scale, CLOSED

**Exit criterion (met)**: a board with ~995 000 locked pieces (no single cluster larger than the hard cap) stays fluid: locked pieces render from server-composited per-cell tiles instead of per-piece fetches, with piece borders preserved; resident client memory stays within the existing budget; no unlocked cluster exceeds `MPP_CLUSTER_PIECE_CAP`.

A locked piece has no gameplay reason to keep a `groupId` once anchored (it can never be dragged again and always renders at the frame origin plus its solved-cell offset), but today's merge logic keeps folding newly-anchored clusters into one ever-growing locked group. Near completion this produces a single cluster of hundreds of thousands of members, and the client's hydration path fetches a whole group's member textures in one unbounded batch: an unbounded-load, likely-crash risk this phase closes before it is ever hit live.

Delivered in 4 stages, each independently shippable and separately testable, since this touches the merge/anchor path (permanent, no undo) and the wire protocol. Stage 1 is backend-only and already closes the crash risk; Stage 2 makes the ~995 000-locked scenario actually testable end to end; Stage 3 is the "see it all at once" rendering polish, at native zoom: composited per-cell tiles replace per-piece fetches wherever a cell has one; Stage 4 exposes it over the wire and wires the frontend onto it, retiring the per-piece fallback entirely. Each stage is meant to be picked up in its own fresh session.

### Stage 1 (backend only): locked pieces stop being a group

- [x] `shared-protocol` / `backend-realtime`: `locked` moves from the group hash to the piece hash (`piece:<id>.locked`); on anchor, the anchored cluster's group is deleted rather than merged into a growing locked group. No live group is ever locked going forward; remove `locked` from `GroupRuntime` and group storage.
- [x] `backend-realtime`: `detectSnap` checks each grid-neighbor's piece-level `locked` flag directly (a locked neighbor is an automatic aligned-at-origin candidate, no tolerance check needed) instead of resolving through `piece.groupId -> group.locked`, which no longer resolves for a locked neighbor.
- [x] `backend-realtime`: hard cap `MPP_CLUSTER_PIECE_CAP` (default 20 000) on merges between two unlocked clusters (skip the merge, both stay separate); merging into a locked neighbor is exempt, since it dissolves a group rather than growing one.
- [x] `backend-realtime` / `qa-and-load`: rewrite `stateInvariants.ts`'s locked check from a union-find component match to a direct comparison of Mongo-replayed locked piece ids against Redis piece-locked flags; update `snap.test.ts`, `handlers.test.ts`, `stateInvariants.test.ts`, `hub.test.ts`, `groupIndex.test.ts` for the new model.

### Stage 2: locked pieces reach the client, decoupled from GroupNode

- [x] `shared-protocol`: `SSnap` carries locked piece ids (grid-unit offset from the frame origin) only when `anchored`; `region_state` streams locked-piece-ids per newly covered cell alongside unlocked groups; `RegionGroup.locked` removed (a `RegionGroup` is always unlocked now); `PROTOCOL_VERSION` bump.
- [x] `frontend-canvas`: locked pieces render from the new flat per-cell delivery, never via `GroupNode` / `hydrateGroup` / `lockedLayer`; still one AVIF fetch per piece at this stage, just outside the cluster machinery and so no longer bounded by cluster size.
- [x] `qa-and-load`: rewrite `seed-lock-scenario.ts` for the new model (mark ~995 000 pieces locked directly, no cluster merging) and verify the crash risk is closed at that scale.

### Stage 3: server-composited locked tiles ("see it all at once")

- [x] `backend-realtime`: incremental per-cell tile compositing (sharp): a debounced dirty-cell queue rebakes a cell from its currently-locked, bordered piece tiles whenever a lock event touches it, cached and versioned in R2 (`PROTOCOL_VERSION` bump for `SRegionState.cellComposites` and the `cell_composite` broadcast). Superseded versions are deleted once the new one is live, so storage stays bounded by cell count. See DECISIONS. `MPP_R2_ENDPOINT`/`MPP_R2_ACCESS_KEY_ID`/`MPP_R2_SECRET_ACCESS_KEY` are set in the Coolify env; compositing is live in prod.
- [x] `frontend-canvas`: consumes the server-composited per-cell tile when available, falls back to Stage 2's per-piece rendering otherwise. See DECISIONS.

### Stage 4: expose composites over the wire, retire per-piece locked hydration

- [x] `shared-protocol` / `backend-realtime`: `region_state` reports every already-baked composite covering its batch's cells (`collectRegionCellComposites`), and a live rebake pushes `cell_composite` to every client whose broadcast-scoped cells overlap it.
- [x] `frontend-canvas`: a new `CompositeTileLayer` (sibling to `LodTileLayer`, not a merge into it: baking a live scene and fetching a server AVIF are different enough lifecycles) fetches and displays every composite tile covering the current viewport as a `Sprite`, added directly to the existing `lockedPiecesLayer`. `hydrateLockedPiece`/`lockedHydrateQueue`/`lockedResident` and the per-piece fallback they existed for are removed rather than kept as a second path: a locked piece never gets its own fetch again. The only bridge between a piece anchoring and its cell's composite catching up is reusing the texture already resident from the local client's own drag (`salvageLockedPiece`, zero fetch), freed once `CompositeTileLayer` confirms coverage or the piece leaves the keep ring, exempt from budget eviction (no re-fetch exists to recover it if freed early). The composite pool's own eviction is byte-weighted (real decoded size), replacing the earlier "1 unit like a single piece" approximation, unsafe once composites became the only rendering path. See DECISIONS.

---

## Phase 6, Real Photo

**Exit criterion**: a real gigapixel source image exists (NASA Blue Marble main image, CC0/public-domain Wikimedia Commons nature and animal tile photos, assembled as a photo mosaic), producible end to end by two dev scripts, and verified to slice cleanly through the existing, unchanged `slice-image.ts` at both a small test scale and the real production scale (grid dimensions matching the source image's own aspect ratio; the puzzle grid does not have to be square). Uploading the asset and switching prod to serve it stays a separate follow-up, as Phase 2's own `image-pipeline` track already treated that step.

### `image-pipeline`
- [x] `fetch-tile-images.ts`: downloads a local library of a few hundred to ~1000 CC0/public-domain nature and animal photos from Wikimedia Commons, with a provenance manifest and idempotent resume. See DECISIONS.
- [x] `build-mosaic.ts`: assembles the NASA Blue Marble image and the tile library into one gigapixel BigTIFF photo mosaic, using the same banded chunk/strip streaming strategy as `synthetic-source.ts`. See DECISIONS.
- [ ] Full-scale run verified: the real mosaic slices cleanly through the unchanged `slice-image.ts` at the validated safe operating point (`--piece-size 72`). See DECISIONS.

---

## Backlog

Ideas worth keeping but not yet committed to a phase. Promote into a phase track when scope and timing are clear.

- **Dynamic max-zoom that grows with progress.** Cap zoom-out early and relax it as pieces are placed, to bound the visible piece count. A fixed 15% zoom floor already exists (see [play-zone hard limits](DECISIONS.md#2026-05-21-frontend-canvas-play-zone-hard-limits)); the progress-relative version is the open idea.
- **Coordinate HUD overlay.** Small overlay showing viewport position (XY, sector, zoom). Needs a "sector" concept first. Revisit at 1M when orientation becomes a real problem.
- **Firewall the origin to Cloudflare IP ranges.** Closes the last DDoS gap: the VPS is still directly reachable so the edge is bypassable and `CF-Connecting-IP` is spoofable. Steps in [DECISIONS topology](DECISIONS.md#2026-05-18-infra-deploy-alpha-topology).
- **DZI-native reveal for locked content.** Prototyped behind `?dziReveal=1` (frontend-canvas): the reference DZI pyramid as an independent zoom-driven tile layer, masked to a server-baked per-cell silhouette (reusing CellCompositor) plus a seam overlay, no longer a flat rectangle. Verified fast and pixel-precise for photo content up to ~100k locked pieces; needs R2 write credentials the same way `CompositeTileLayer` does. First real-scale pass (994,977 / 1,000,000 locked) found the per-cell mask/seam VRAM budget thrashed badly (native-resolution cells only, no LOD tiering); fixed with 3 LOD tiers. A second real-scale pass found that fix still insufficient: the tier crossover math never actually reached its own coarse tiers across most of the playable zoom range, the combined-mask rebake had no throttle at all while panning (the dominant cause of reported lag), and the DZI photo layer had no coarse-first fallback so nothing showed until the exact right tile landed, unlike the reference-image thumbnail sitting right next to it. All three fixed: corrected tier breakpoints, an unconditional rebake throttle, and a small always-resident base level covering the whole image (`pickBaseLevel`) so the photo appears immediately everywhere the mask allows. A third real-browser pass at the same scale found the actual cause of the incomplete-coverage symptom the first two passes never touched: the combined mask sprite had no parent, so it never inherited the camera's pan/zoom and stayed fixed on screen while the board moved underneath it, at every zoom level, not just min-zoom. Fixed by parenting it under the same container `tileContainer` lives in. A fourth real-browser pass (994,977 / 1,000,000 locked) confirmed the parenting fix holds, but found two new, independent defects: the DZI background layer visibly softer than the default AVIF composite path at the same zoom (the DZI pyramid encodes WebP at the same numeric quality the AVIF piece/composite tiles use, but WebP is the less efficient codec at an equal quality number), and a total rendering blackout from ~350% zoom to `MAX_ZOOM`, confirmed via browser console as a WebGL failure (`GL_INVALID_OPERATION` "Texture total allocation size is too large", framebuffer "Attachment has zero size") traced to the mask texture's `antialias: true` forcing a multisampled renderbuffer that Pixi's GL backend reallocates on every resize, up to 5x/second while zooming. Both fixed: the DZI pyramid now bakes WebP at a decoupled, higher quality than the AVIF pieces; `antialias: true` dropped from the mask texture (the true piece border is already drawn crisp and unmasked by the seam overlay, so the mask itself only needs to be roughly right, not smooth). A fifth real-browser pass hit the identical WebGL crash again despite that fix being confirmed live. First traced to a second, unrelated site sharing the same anti-pattern (`lodTiles.ts`'s always-on zoom-out LOD tile bake, also using `antialias: true`, never audited against this failure mode, fixed the same way) but the reporter hit the exact same crash again immediately after, pinned this time to 500% zoom with a screenshot. The actual cause: Pixi's mask/filter system inherits antialias from the main canvas's own `Application.init({antialias: true})` for any Sprite mask (`dziRevealLayer.ts` masks `tileContainer` with one), sizing its own internal filter texture to the masked container's on-screen bounds, so it hits the same crash independently of anything `dziRevealLayer.ts` itself controls. Fixed by dropping `antialias: true` from the main canvas init; the only visible cost is softer edges on a few small vector-drawn UI accents (peer cursors, snap-flash glow, sticky-carry outline), not the pieces themselves (pre-baked bitmap borders). A sixth real-browser pass hit a different WebGL crash at the same 500% zoom, missing the MSAA-specific error line that fingerprinted the antialias fixes above: Pixi's mask filter sizes its intermediate texture off the masked container's full unclipped bounds (`MaskFilter` hardcodes `clipToViewport: false`), which include the always-resident whole-image base layer, so the requested size scales with zoom regardless of antialiasing and exceeds GL_MAX_TEXTURE_SIZE past a few hundred percent. Fixed via Pixi's `Container.boundsArea`, clamping the masked container's bounds to the same viewport-derived ring the mask sprite itself already uses. That fix shipped a regression, caught by a seventh real-browser pass minutes later (confirmed via a live-bundle content-hash check against a fresh local build, an exact match): `boundsArea` set on a container that also carries a mask effect is a genuine Pixi gotcha that silently corrupts that container's own computed bounds, turning the crash from "past ~350% zoom" into "at any zoom, confirmed at 53%", plus a new "unlocked pieces render solid black" symptom. Fixed by moving `boundsArea` off the masked `tileContainer` entirely, onto the effect-free `baseTileContainer` child instead. Synthetic reproduction of the exact interaction gave inconsistent results even at realistic scale (Pixi's bounds caching depends on a real per-frame render pass a scripted test doesn't reliably provide), so this fix rests on a source-level structural argument, not a reproduced crash-to-no-crash transition; whether it resolves the original report or only the regression is unconfirmed. Still pending: an eighth real-browser pass to confirm the original crash is actually gone (not just the regression) and that the black-pieces symptom doesn't recur, regenerating and re-uploading the DZI pyramid at the new quality (a full re-slice plus a multi-GB R2 re-upload, not run yet), and whether this replaces `CompositeTileLayer` in production or the two coexist behind a flag. See [DECISIONS](DECISIONS.md#2026-07-28-frontend-canvas-dzi-reveal-mask-and-seam-baked-server-side-via-cellcompositor).
