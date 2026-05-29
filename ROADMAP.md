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
- [x] Generation validated and stable at 10 000 pieces

### `image-pipeline`
- [x] Deep Zoom tile pyramid produced for the source image and uploaded to R2
- [x] Per-piece AVIF set uploaded to R2 with manifest

### `frontend-shell`
- [x] Landing page presents the project and a single CTA to enter the canvas
- [x] Spectator/contributor mode toggle works, no auth required
- [x] Spectator mode consumes `GET /snapshot` instead of opening a WebSocket: spectators do not count against the WS budget, the canvas renders pieces and clusters from the polled snapshot at the publisher cadence, the "Contribute" CTA upgrades the session to a WebSocket on click, and a snapshot `puzzleId` change triggers a clean rebuild

### `frontend-canvas`
- [x] OpenSeadragon reference panel shows the source image
- [x] Frustum culling active, rendering stays smooth while playing (zoomed in) at 10 000 pieces
- [x] Mini-map shows global progress
- [x] Collaborator cursors rendered from presence messages (colored pointer, pseudo tag, held-piece preview, idle-bob)

### `backend-realtime`
- [x] Viewport-neighbor broadcast scoping for drag and drop: the `viewport` client message is wired server-side; drag and drop reach only clients whose reported viewport contains the event point, snap stays a global broadcast, and clients with no viewport yet receive everything
- [x] Periodic snapshot generation published to CDN for spectator mode
- [x] WebSocket messages validated at the dispatch boundary: malformed or out-of-range groupId and non-finite coordinates are rejected as bad_message before any Redis access, and grab on a non-existent group fails instead of creating a junk key
- [x] WebSocket boundary hardened: Origin allowlist (`MPP_ALLOWED_ORIGINS`), per-frame size cap (`maxPayload`), per-connection token-bucket rate limit, and outbound backpressure close on slow consumers

### `auth-and-accounts`
- [x] Anonymous pseudo entry (name, no verification) attached to the session

### `infra-deploy`
- [x] Server deployed on Hetzner via Coolify
- [x] Cloudflare in front for the frontend (Pages on `app.millionpiecepuzzle.com`) and the backend hostname (`ws.millionpiecepuzzle.com`, DNS+SSL via Let's Encrypt at Coolify)
- [x] Cloudflare CDN edge cache for spectator-mode snapshots
- [x] R2 buckets configured for tiles and piece textures

### `tooling-foundations`
- [x] Stable, no further work expected

### `qa-and-load`
- [x] Stateful server logic covered by unit tests: the merge-and-anchor path (`handleDrop` / `applyMerge`) and the serial dispatch queue
- [x] Load test reproduces 20 concurrent clients dragging on a 10 000-piece puzzle without server saturation

### `legal`
- (not in Phase 1, closed alpha by invitation only)

### `complementary`
- [x] `frontend-shell` + `backend-realtime`: Closed-alpha feedback prep on the `develop` branch: landing passcode gate, a single puzzle (`alpha-3`, 2040 pieces) loaded from R2 at boot via `MPP_PUZZLE_ID` + `MPP_ASSETS_BASE_URL` that the server holds until reset (no rotation, completion freezes the puzzle in the `completed` state), dev controls on `/play` (Place piece, Reset puzzle, Complete) gated by `MPP_DEV_ENABLED` and `VITE_DEV_BUTTONS`, leaderboard panel hidden for now
- [x] `frontend-shell`: Replace header spectator/contributor toggle with a floating "Contribute" CTA at bottom-right on the spectator view (supersedes the toggle task above)
- [x] `frontend-canvas`: Client emits throttled `viewport` presence messages on pan, zoom, and resize, which activates the server-side drag and drop broadcast scoping
- [x] `frontend-canvas`: Leaderboard rendered in the completion modal (per-user snap counts derived on demand from `ClusterMerge`)
- [x] `backend-realtime` + `shared-protocol`: Activity ticker backfilled with recent `ClusterMerge` history on connect, so the feed is populated even for events that happened before the client joined (currently the ticker only shows snaps received live)
- [x] `frontend-canvas`: Play-zone hard limits. The board is bounded by a play zone (the puzzle frame unioned with every scattered piece, widened by a margin, mirrored around the frame center, and snapped to the world grid), computed once on the server and sent to every client. The camera cannot pan beyond it plus a small padding ring, the area outside is darkened with a coarse checker motif, held pieces are clamped so none can leave it, and minimum zoom is raised from 5% to 15%. The minimap (bottom-right) insets the zone within an out-of-bounds band and draws the puzzle frame, pieces as pixels, and the camera frustum; the spectator Contribute card stacks above it.
- [x] `frontend-canvas` + `backend-realtime`: Leaderboard panel restored on `/play`; the server rebroadcasts standings after every anchoring snap and on join so the in-game panel stays live, not just the completion modal.
- [x] `frontend-canvas`: Bug. `usePuzzleSession` maps every server `error` message to a fatal `state: "error"`. Transient codes reach the client in normal play (`not_held` / `unknown_group` from optimistic `drag` after a denied grab or a remotely merged held group; `dev_disabled` when dev buttons show with `MPP_DEV_ENABLED=0`) and blank the puzzle until the next rebuild. Exit: transient errors keep the session alive (logged or shown briefly); only `protocol_mismatch` and connection loss are fatal.
- [x] `frontend-canvas`: Bug. `PuzzleStage.clearWorld` detaches children with `removeChildren()` without destroying them, leaking every piece `Container` / `Sprite` / `Graphics`, the frame and the backdrop on each rebuild. Exit: cleared display objects are destroyed (geometry and masks freed); no memory growth across rebuilds.
- [x] `frontend-canvas`: Bug. The play zone is computed per client in `PuzzleStage.build` from the join-time `state`, so clients joining at different times derive different zones. Remote positions are applied unclamped, so a piece dragged to an early client's zone edge lands outside a late client's smaller zone (unreachable, in the dark backdrop), and camera limits and minimap extent diverge between clients. Exit: all clients enforce the same play zone for a given puzzle.
- [x] `frontend-canvas`: Bug. The `watch(state)` callback in `PuzzleCanvas.vue` is async with no in-flight guard, so a `state` change during an unfinished `build()` (e.g. `dev_reset` mid texture load) interleaves two builds and orphans the previous puzzle's sprites on the canvas. Exit: a new build waits for or cancels the in-flight one; no stale sprites after a rapid state change.

#### Closed-alpha feedback (first `main` deploy)

- [x] `backend-realtime`: Scatter decorrelated from the solved image and kept out of the frame. The scatter randomizes the group origin, but pieces render at `origin + canonicalOffset` (the solved cell), so the shuffled board is the source image plus bounded jitter (sky pieces sit high, ground low). Exit: each piece's initial world position is sampled from a ring around the frame, independent of its solved cell; no piece body starts inside the frame interior.
- [x] `frontend-canvas`: Leaderboard empty state. Exit: the leaderboard panel shows a placeholder message when there are no standings instead of rendering blank.
- [x] `frontend-canvas`: Reference panel opens enlarged on click. Exit: clicking the reference panel opens a larger dismissible view of the source image with full-resolution Deep Zoom (OSD/DZI), restoring the panel on close.
- [x] `backend-realtime`: Scatter shaped as an oval and spread out more. Exit: the initial scatter forms an elliptical cloud sharing the frame aspect, spaced wider than the rectangular ring, with no piece body inside the frame interior.
- [x] `frontend-canvas`: Reference modal centered with a fixed border and reduced drag elasticity. Exit: the enlarged reference opens centered (fit on open) with a fixed border; OpenSeadragon pan/zoom is constrained to the image with a stiffer spring, leaving only a small glide and no overscroll bounce.
- [x] `frontend-canvas`: Reset hides the previous board. Exit: on `dev_reset` the old puzzle is hidden behind a loading state until the new board is ready; no stale board is shown during the rebuild.
- [x] `frontend-shell` + `frontend-canvas`: Staged load with progress. Exit: arriving on `/play` shows explicit progress through the load states (connect, manifest, textures, ready) with a progress indicator; the board renders only when ready, never partially built.
- [x] `frontend-canvas`: Reference views render reliably next to the WebGL stage. Exit: the sidebar reference thumbnail and the enlarged modal both show the source image when the play page is loaded, instead of a blank viewer.
- [x] `frontend-canvas`: Reference modal centered in the play zone with even margins. Exit: the enlarged reference window is centered within the play area below the header, with equal spacing on the left, right, top, and bottom.
- [x] `backend-realtime`: Scatter reshaped into a detached center-dense rounded-square band. Exit: the initial scatter forms a rounded-square band (superellipse bounds sharing the frame aspect) detached from the frame by an empty gap, dense in the middle of the band and dispersing toward both edges, with no piece body inside the frame interior.
- [x] `backend-realtime`: Dev Complete actually assembles the board. The button anchored the locked counter and faked a snap, leaving pieces scattered. Exit: force-complete anchors every group at the frame origin (each piece in its solved cell), sets the locked count to the total, and rebroadcasts the fresh state so all clients rebuild onto the finished picture.
- [x] `frontend-canvas`: Completion summary waits for the board. On reload of a completed puzzle the modal opened over the still-visible loading cover, hiding the canvas. Exit: the completion modal and its reopen button only render once the board is on screen (loading steps finished), so the assembled canvas is visible behind the summary.
- [x] `backend-realtime` + `shared-protocol` + `frontend-shell`: Spectator leaderboard and activity. Both feeds were only emitted on the WebSocket path, so spectators polling `GET /snapshot` saw empty panels. Exit: the snapshot carries `leaderboard` and `activity`, the publisher fills them from Mongo, and the spectator session applies them so the in-game panels populate without a WebSocket.
- [x] `backend-realtime`: Reset clears the derived feeds. `dev_reset` wiped Redis but not the merge log, so the leaderboard and activity feed kept showing the old puzzle's standings after a reset. Exit: `resetCurrent` clears the puzzle's `cluster_merges`, so the fresh board's leaderboard and activity feed start empty (Redis was already wiped).
- [x] `backend-realtime`: Dev Complete credits the executor. Force-complete logged no merge, so the leaderboard credited nobody for the assembled board. Exit: `dev_complete` logs one merge crediting the executing client for every piece not already attributed (first-merge scoring leaves earlier contributions intact), and the rebroadcast leaderboard reflects it.
- [x] `frontend-shell`: Contributor entry points hidden on completion. Exit: once every piece is locked, the spectator Contribute card is hidden and the "Become a contributor" modal will not open (closes if already open).

#### Performance pulled forward from Phase 2

Built as the real Phase 2 solution, not a stopgap, so none is thrown away at 1M scale. The Phase 2 items that stay deferred (viewport and write sharding) are blocked on the single-writer alpha topology, not on piece count.

- [ ] `frontend-canvas`: Drag throttling. Coalesce drag broadcasts to one message per animation frame, sending the last point. Exit: at most one `drag` per frame per held cluster; sustained drag ingest drops from per-pointermove to per-frame with no added visible lag.
- [ ] `backend-realtime`: Per-group dispatch queues replacing the global serial queue. Exit: messages for independent groups process concurrently while per-group order is preserved and the merge/anchor read-modify-write stays serialized per group.
- [ ] `frontend-canvas`: Zoom-out level of detail via render-to-texture. Exit: past a zoom-out threshold the board renders from a periodically refreshed low-res render texture instead of per-piece masked sprites; the fully zoomed-out view stays smooth at 10 000 pieces.
- [ ] `backend-realtime`: Per-IP rate limit extending the per-connection token bucket. Exit: a single IP cannot exceed configured connection and message budgets regardless of how many sessions it opens.

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
- [ ] Zoom-out LOD scales to 1M: move from the Phase 1 render-texture LOD to pipeline aggregated tiles if render-texture does not hold at full scale
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
