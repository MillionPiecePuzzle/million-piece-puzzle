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

## Phase 0, Local MVP

**Exit criterion**: a single user completes a puzzle of N configurable pieces in a browser, with the full architecture running locally (WS server + Redis + Mongo via docker-compose), in anonymous mode.

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
- [x] Play page shows mode toggle (spectator vs contributor), auth modal stub present but inactive

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
Polish and bugs surfaced while testing the closed Phase 0. Not gating the phase exit criterion (already met), but to land before moving on to Phase 1.
- [x] `backend-realtime` + `frontend-canvas`: Frame-based anchoring. No special piece 0. The puzzle frame (rectangle `(0,0)` to `(cols*S, rows*S)`) is the anchor and is rendered on the canvas. Init scatters all groups freely, including positions inside the frame, so a million-piece board does not require traversing the outside. A cluster locks only on a human drop when its origin reaches `(0,0)` within `snapTolerance`; a piece that happens to scatter at its canonical position is not auto-locked. Completion = all pieces locked.
- [x] `frontend-canvas`: Persistent confetti loop after completion, centered congrats modal with show/hide puzzle toggle (leaderboard deferred to Phase 1, requires auth + multi-user)
- [x] `piece-generation`: Knob/blank shapes tuned closer to classical jigsaw silhouettes (see [circular bulb head](DECISIONS.md#2026-05-13-piece-generation-circular-bulb-head))
- [x] `frontend-shell` + `frontend-canvas`: Play-page chrome from the design handoff rendered on `/play`, faithful to the handoff colors, spacing and panel chrome: topbar caption (puzzle name from the manifest) and progress pill wired to live session state, working zoom controls rail, floating Leaderboard panel (mocked data) with a paginated full-board modal, floating Activity ticker panel (live snap events), stage backdrop with a zoom-adaptive hairline grid

#### Post-audit punch list

Findings from the Phase 0 code audit. Same gating rule as the rest of `complementary`: land before Phase 1.

- [x] `tooling-foundations`: Repo back to green. `npm run lint`, `npm run format:check` and `npm run typecheck` all pass with no errors.
- [x] `tooling-foundations` + `piece-generation`: Doc drift fixed. `CLAUDE.md` describes frame-based anchoring (not the removed piece-0 model), `edge.ts` documents `headRoundness` as the bulb radius ratio, ROADMAP wording matches the implemented snap geometry.
- [x] `backend-realtime`: Incoming WebSocket messages are serialized through a global dispatch queue, so concurrent messages can no longer interleave on `await` points in `handleDrop`.
- [x] `backend-realtime`: `detectSnap` no longer merges neighbour groups that are within tolerance of the dropped group but not mutually aligned.
- [x] `shared-protocol` + `backend-realtime` + `frontend-canvas`: `SWelcome` trimmed to server-only fields. Fields derivable from the image manifest the client already fetched are removed from the wire.
- [x] `frontend-canvas`: `PuzzleWsClient` surfaces connection errors to the session state instead of freezing silently.
- [x] `frontend-canvas`: Duplication removed. Shared `LeaderboardRow` component for the panel and modal, shared manifest-URL resolution, shared Redis hash parsing in `RedisState`.
- [x] `qa-and-load`: Unit tests cover the deterministic core (`prng`, `generatePuzzle`, `piecePath`, `detectSnap`).
- [x] `backend-realtime`: Initial puzzle write in `initPuzzleIfEmpty` is pipelined instead of three sequential Redis round trips per piece.
- [x] `backend-realtime`: Disconnect cleanup runs on the dispatch queue. `releaseHeldGroups` (triggered by `ws.on("close")`) currently runs off-chain, so its `await` points can still interleave with an in-flight handler mutating the same group. Route it through the same queue as incoming messages.

---

## Phase 1, Closed Alpha

**Exit criterion**: 5 to 20 invited people, connected concurrently, complete a 10 000-piece puzzle on a deployed instance, in anonymous mode.

### `shared-protocol`
- [ ] Protocol version field added to handshake
- [ ] Presence messages (join, leave, viewport) defined

### `piece-generation`
- [ ] Generation validated and stable at 10 000 pieces

### `image-pipeline`
- [ ] Deep Zoom tile pyramid produced for the source image and uploaded to R2
- [ ] Per-piece AVIF set uploaded to R2 with manifest

### `frontend-shell`
- [ ] Landing page presents the project and a single CTA to enter the canvas
- [ ] Spectator/contributor mode toggle works, no auth required

### `frontend-canvas`
- [ ] OpenSeadragon reference panel shows the source image
- [ ] Frustum culling and LOD active, rendering stays smooth at 10 000 pieces
- [ ] Mini-map shows global progress
- [ ] Collaborator cursors rendered from presence messages (colored pointer, pseudo tag, held-piece preview, idle-bob)

### `backend-realtime`
- [ ] Viewport-neighbor broadcast scoping for drag and drop events
- [ ] Periodic snapshot generation published to CDN for spectator mode

### `auth-and-accounts`
- [ ] Anonymous pseudo entry (name, no verification) attached to the session

### `infra-deploy`
- [ ] Server deployed on Hetzner via Coolify
- [ ] Cloudflare in front (Pages for frontend, CDN for snapshots, DNS, SSL)
- [ ] R2 buckets configured for tiles and piece textures

### `tooling-foundations`
- [ ] Stable, no further work expected

### `qa-and-load`
- [ ] Load test reproduces 20 concurrent clients dragging on a 10 000-piece puzzle without server saturation

### `legal`
- (not in Phase 1, closed alpha by invitation only)

### `complementary`
- [ ] `frontend-shell`: Replace header spectator/contributor toggle with a floating "Contribute" CTA at bottom-right on the spectator view (supersedes the toggle task above)
- [ ] `frontend-canvas`: Leaderboard rendered in the completion modal (per-user snap counts derived on demand from `ClusterMerge`)
- [ ] `frontend-shell`: Decide whether to add the live builders indicator (green dot + count) to the topbar
- [ ] `frontend-canvas`: Decide whether to add the Coord HUD overlay (sector / XY / zoom)
- [ ] `frontend-canvas`: Decide whether to add the search bar (jump to coordinates / sector / piece ID, with `⌘K`)
- [ ] `frontend-canvas`: Decide whether to add the minimap / overview panel
- [ ] `frontend-canvas`: Decide whether to add the piece tray (slots + shuffle / auto-sort / draw actions)
- [ ] `backend-realtime` + `shared-protocol`: Activity ticker backfilled with recent `ClusterMerge` history on connect, so the feed is populated even for events that happened before the client joined (currently the ticker only shows snaps received live)

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
