# Decisions

Running log of non-obvious development choices. Each entry: the choice, the rationale, and (when relevant) the scale at which it must be revisited.

When a decision is refined, edit its entry in place so it always describes the current choice. When a decision is fully superseded, delete the stale entry rather than layering "supersedes" notes on top of it. The log should read as what is true now, not as a history of what changed.

## Format

```
### YYYY-MM-DD, track, short title
Choice: what was decided.
Why: the reason.
Revisit when: trigger that should force a rethink (optional).
```

---

## Revisit-later index

Quick scan of choices that knowingly do not scale to Phase 2 (1M pieces, public). Each links to the full entry below.

- [State sync sends full pieces + groups arrays on join](#2026-05-12-shared-protocol-full-state-on-join) -> shard by viewport in Phase 1+.
- [Absolute world coordinates on every drag frame](#2026-05-12-shared-protocol-absolute-coords-on-drag) -> consider deltas or quantization if bandwidth becomes a constraint.
- [Drop implicitly releases the held cluster, no explicit release message](#2026-05-12-shared-protocol-drop-implies-release) -> may need an explicit release if disconnect handling diverges from drop semantics.
- [Edge params now 8 floats with circular bulb head](#2026-05-13-piece-generation-circular-bulb-head) -> revisit if silhouettes degenerate or if more variety is wanted.
- [Default `pieceSize = 100` in generator output](#2026-05-12-piece-generation-piecesize-default) -> image pipeline will pin the real pixel size; consumer should pass it explicitly once known.
- [Image pipeline emits rectangular tiles without silhouette mask](#2026-05-12-image-pipeline-rectangular-tiles) -> revisit if client-side masking shows up in render profiling at Phase 1+ scale.
- [Piece tiles flat in `pieces/`, no folder bucketing](#2026-05-12-image-pipeline-flat-tile-layout) -> add bucketing in Phase 1+ when N exceeds a few thousand.
- [Image pipeline derives `pieceSize` from image dimensions and center-crops](#2026-05-12-image-pipeline-adaptive-piecesize) -> revisit if non-centered crops or aspect-fitting become useful.
- [Server boots with an ordered list of manifests and cycles sequentially](#2026-05-18-backend-realtime-manifest-list-and-cycle) -> replace with a Mongo-backed puzzle catalog and explicit lifecycle when the alpha ends.
- [Snap detection compares group origins for equality within tolerance](#2026-05-12-backend-realtime-snap-by-origin) -> stable assumption; revisit only if canonical offsets stop being puzzle-global (e.g., rotation enabled).
- [Server Docker image installs all workspace runtime deps](#2026-05-12-backend-realtime-docker-all-workspace-deps) -> trim once image size matters.
- [Piece outline approximated by 8 cubic Beziers per curved edge](#2026-05-13-piece-generation-edge-path-topology) -> revisit if silhouettes look degenerate or if a tighter approximation is needed for snap visuals.
- [Vite dev middleware serves `generated/<id>/` at `/puzzle/`](#2026-05-12-frontend-canvas-vite-puzzle-middleware) -> drop once Phase 1 points the frontend at R2 and the slice output no longer needs a local HTTP face.
- [Piece hit testing uses the sprite bounding rect, not the mask silhouette](#2026-05-12-frontend-canvas-bounding-rect-hits) -> revisit once overlap zones between adjacent unmerged pieces produce confusing pickups.
- [Drag broadcasts sent on every pointermove without throttling](#2026-05-12-frontend-canvas-drag-no-throttle) -> coalesce with requestAnimationFrame once the WS shows backpressure or high-rate mice flood the server.
- [Global serial dispatch queue for all WS messages](#2026-05-14-backend-realtime-global-serial-dispatch-queue) -> per-process total order; scaling the writer past one instance needs an atomic Lua merge, a regional lock, or write sharding.
- [Cascade entrance animation descoped from Phase 0 to Phase 2](#2026-05-12-frontend-canvas-cascade-deferred) -> requires event scheduling (`eventStartsAt`) and a landing countdown to be meaningful; building it now would mean rebuilding it twice.
- [Alpha puzzle fixtures `generated/alpha-{1,2,3}/` committed and baked into images](#2026-05-15-infra-deploy-alpha-fixtures-committed) -> drop the commits and the Dockerfile `COPY` lines once the image pipeline serves the same artifacts from R2.
- [Closed-alpha gate is a frontend-only passcode](#2026-05-18-frontend-shell-alpha-passcode) -> replace with a server-validated invite token (or full auth) before opening the alpha beyond known testers.
- [Dev controls (reset/complete) exposed on /play, server-gated by env var](#2026-05-18-frontend-shell-dev-controls) -> set `MPP_DEV_ENABLED=0` and `VITE_DEV_BUTTONS=0` before the first non-tester users land.
- [Alpha topology: single VPS, Coolify on the workload host, Cloudflare DNS-only for `ws.*`](#2026-05-18-infra-deploy-alpha-topology) -> split Coolify control plane from workload, and consider Cloudflare-proxied origin or R2 fronting, before Phase 2 public traffic.
- [WS hardening: Origin allowlist, per-connection token bucket, frame size cap, backpressure close](#2026-05-18-backend-realtime-ws-hardening) -> tune limits once load tests run; replace per-process bucket if the writer is sharded.
- [Drag and drop broadcasts scoped to the receiver viewport](#2026-05-20-backend-realtime-viewport-scoped-drag-and-drop-broadcasts) -> Phase 2 viewport sharding plus incremental subscriptions.
- [Anonymous pseudo lives on the session, not in Mongo](#2026-05-20-auth-and-accounts-anonymous-pseudo-on-the-session) -> Phase 2 moves it to a verified Mongo user profile with real auth.
- [Completion leaderboard scored from the full ClusterMerge log](#2026-05-21-frontend-canvas-completion-leaderboard-scoring) -> precompute a per-user counter at 1M scale.

---

## Log

### 2026-05-12, shared-protocol, full state on join

Choice: `SState` carries the complete `pieces` and `groups` arrays in a single message on connect.
Why: trivial to implement, fine at Phase 0 scale (N up to a few thousand pieces, single user).
Revisit when: Phase 1 (10k pieces, 20 clients) and Phase 2 (1M pieces). Replace with viewport-scoped initial state plus incremental subscriptions.

### 2026-05-12, shared-protocol, absolute coords on drag

Choice: `CDrag` and `SDrag` carry absolute `worldX, worldY` instead of deltas.
Why: robust to packet loss and reorderings, simpler client reconciliation, no integration of deltas. Cost is a few extra bytes per frame.
Revisit when: drag broadcast bandwidth shows up in profiling, or when we add per-frame rotation. Quantize to integer pixels or switch to int16 deltas if needed.

### 2026-05-12, shared-protocol, drop implies release

Choice: no explicit `release` message. `CDrop` finalizes the position and releases the cluster lock atomically.
Why: one round trip instead of two, one less message type, matches mouse-up semantics.
Revisit when: we need to distinguish "user let go" from "client disconnected mid-drag". Today both are handled by drop + connection close; if the snap/anchor logic later cares about that distinction, add an explicit release.

### 2026-05-12, shared-protocol, PROTOCOL_VERSION bump

Choice: bumped `PROTOCOL_VERSION` from 0 to 1.
Why: first non-empty protocol surface. Version field is asserted in `welcome` so a mismatched client gets `protocol_mismatch` rather than malformed-message errors.
Revisit when: any breaking wire change. Phase 1 freezes presence messages; Phase 2 freezes v1.

### 2026-05-20, shared-protocol, presence messages

Choice: presence is four message types. Client to server: `viewport` (visible world rect, for broadcast scoping) and `cursor` (pointer in world space). Server to client: `join` (userId, pseudo), `leave` (userId), and `cursor` (a peer's pointer, relayed to viewport-neighbor peers). There is no server `viewport` relay; cursor and viewport are split rather than carried in one combined presence message.
Why: viewport and cursor both change on every zoom and pan, but from independent triggers (wheel/pan vs pointermove), so a combined message would resend one half's unchanged fields on every tick of the other. Separate messages let each be throttled on its own cadence. Viewport has no client-facing consumer yet (only the server scopes broadcasts with it), so relaying it would be speculative. Cursor carries finite coordinates only: a pointer leaving the canvas is expressed by the client pausing its cursor stream, the same way `drag` stops at drop.
Revisit when: a minimap or overview wants to draw peer viewports (add a server `viewport` relay then), or the renderer needs to distinguish "pointer left the canvas" from "peer idle" (add an explicit off-canvas signal). Both `viewport` and `cursor` are now wired server-side: `viewport` is stored per client to scope drag and drop broadcasts, `cursor` is relayed to viewport-neighbor peers, and `join` is also re-emitted to peers when a client changes its pseudo so presence tags refresh without a new message type.

### 2026-05-12, piece-generation, canonical sign convention

Choice: each shared edge derives `sign` once from a canonical subseed. The piece whose `bottom` or `right` uses the edge takes the canonical sign, the piece whose `top` or `left` uses it takes the opposite. All other params (`center, neck, depth, shoulder, tension, tilt`) are shared as-is.
Why: all edges are traversed start-to-end in the same world direction by both neighbors (top/bottom left-to-right, left/right top-to-bottom). With identical traversal, only the sign needs to flip to express "bump out of A" vs "bump into B". Avoids mirroring continuous params.
Revisit when: never expected. If we change the traversal convention (e.g., for clockwise outline assembly in the renderer), this assumption must be re-derived.

### 2026-05-13, piece-generation, circular bulb head

Choice: edges carry 8 continuous params (was 6). Two new params added (`shoulderRun`, `headRoundness`) and existing params reinterpreted. The head is now a true circular bulb whose radius `r = headRoundness * depth` is strictly larger than the neck half-width by construction of the ranges, giving the classical lightbulb silhouette. Ranges: `center 0.46-0.54` (tab x position), `neck 0.055-0.085` (half-width of the neck pinch), `depth 0.24-0.30` (apex outward extent), `shoulder -0.025 to -0.005` (small undercut at the neck), `tension 0.25-0.40` (rise tangent scale), `tilt +-0.03` (bulb x asymmetry), `shoulderRun 0.10-0.16` (flat baseline length each side), `headRoundness 0.45-0.55` (bulb radius / depth ratio).
Why: earlier attempts that simply tweaked control-point offsets produced bulb widths comparable to the neck, which reads as a rectangular tab. The only robust fix is to parameterize the head as an actual circle whose radius is decoupled from the neck width, and enforce `r > neckHalfWidth` through the ranges (`r_min = 0.45 * 0.24 = 0.108 > 0.085 = neck_max`). Adding two floats keeps per-edge entropy comparable; the continuous space across ~2M edges remains non-degenerate.
Revisit when: silhouettes look degenerate, neighbors visibly misalign at snap, or we want more visual variety (widen ranges, vary bulb verticality, add a separate neck-height param). Validate against self-intersection once a large-N visual sample exists.

### 2026-05-13, piece-generation, edge path topology

Choice: the renderer (path.ts) walks each curved edge as 8 cubic Bezier segments: flat shoulder, rise-lower (baseline to neck pinch with undercut), rise-upper (neck pinch outward to bulb equator), bulb top-left quarter arc, bulb top-right quarter arc, fall-upper, fall-lower, flat shoulder. The two bulb arcs approximate a true circle using the canonical cubic Bezier handle length `0.5523 * r`.
Why: the bulb being a circle is what makes the silhouette read as a jigsaw piece rather than a generic curve. Separating the rise into "lower" (under the baseline, undercut) and "upper" (outward swing from neck to bulb equator) lets the neck pinch be an actual sharp narrowing rather than a smooth bulge. 4 or 6 segments do not have enough endpoints to encode a flat baseline + undercut + neck pinch + circular bulb.
Revisit when: GPU cost of triangulating ~8 cubics per curved edge at 1M pieces shows up in profiling. Drop the two flat-shoulder cubics in favor of `L` line commands first; further compaction would mean sacrificing the circular bulb.

### 2026-05-12, piece-generation, pieceSize default

Choice: `generatePuzzle` defaults `pieceSize` to 100 (world units = pixels at native resolution).
Why: convenient placeholder for tests and Phase 0. The real value will be set by the image pipeline once piece textures are sized.
Revisit when: image pipeline produces the per-piece AVIF set. Pass the actual pixel size explicitly and drop the default, or align the default with whatever the pipeline emits.

### 2026-05-12, piece-generation, Bezier rendering deferred

Choice: the generator emits only raw edge parameters. The conversion from parameters to cubic Bezier segments (handles, control points) is not implemented here.
Why: that conversion is needed only for rendering. It belongs naturally with the PixiJS canvas work in track `frontend-canvas`.
Revisit when: starting `frontend-canvas`. Add a function `edgeToCubicSegments(edge, length): CubicSegment[]` either in this generator module or alongside the renderer, whichever is cleaner.

### 2026-05-12, image-pipeline, rectangular tiles

Choice: the slicer emits square AVIF tiles of `pieceSize + 2 * margin` pixels centered on each grid cell, without applying a bezier silhouette mask. The frontend will mask client-side at render time during track `frontend-canvas`.
Why: keeps the param-to-Bezier-path work in one place (the renderer), avoids tuning silhouettes before we have a visual feedback loop, and makes silhouette changes free to iterate without re-running the pipeline.
Revisit when: client-side masking shows up in profiling at Phase 1 (10k pieces) or Phase 2 (1M). Pre-mask on the server side and upload alpha-cut AVIFs to R2.

### 2026-05-12, image-pipeline, tile margin

Choice: tile margin defaults to `round(0.35 * pieceSize)`, just above the max `depth` param (0.30) of the generator.
Why: ensures tabs always fit inside the tile with a small safety buffer.
Revisit when: edge param ranges widen, or rotation is enabled (tabs may then point in unexpected directions and the margin assumption changes).

### 2026-05-12, image-pipeline, flat tile layout

Choice: piece tiles are written flat in `<output>/pieces/NNNN.avif`, zero-padded to at least 4 digits.
Why: trivial at Phase 0 scale (49 pieces). The bucketed `pieces/0000/0000.avif` layout described in CLAUDE.md is overkill until N grows.
Revisit when: Phase 1 (10k pieces) or Phase 2 (1M). Introduce per-100 or per-10000 bucket folders to keep filesystem listings sane.

### 2026-05-12, image-pipeline, adaptive pieceSize

Choice: `--piece-size` is optional. When omitted, the script derives `pieceSize = floor(min(width/cols, height/rows))` from the source image and center-crops the puzzle area to `cols*pieceSize` by `rows*pieceSize`. Any leftover band on the longer axis is discarded.
Why: the user wants to drop any image and have the pipeline adapt, not the other way around. Center-crop keeps the visually important center of the image.
Revisit when: a workflow needs to preserve the full image (no crop), align the puzzle to a non-center anchor, or use non-square pieces.

### 2026-05-18, backend-realtime, manifest list and cycle

Choice: the server reads `MPP_MANIFESTS` (comma-separated paths to slicer manifests) at boot. It tracks the currently active `puzzleId` in Redis under `puzzles:active`. On boot it resumes the last-active one (or the first manifest if none was stored). Every WebSocket `welcome` carries the active `puzzleId`, and the frontend fetches `/puzzles/<puzzleId>/manifest.json` after receiving it. When the active puzzle completes (locked count reaches total) or a `dev_complete` is received, the server wipes that puzzle's Redis state, advances to the next manifest (wrapping), re-initializes it, persists the new active id, and re-sends `welcome`+`state` to every connected client.
Why: testers want to feel "the puzzle changes" without the heavier multi-puzzle-routing refactor. Sequential rotation keeps the server mono-puzzle at any instant: handlers, snap, and merge logic stay unchanged, only the lifecycle around init/teardown is new. `MPP_MANIFEST` (single path) remains a fallback so local one-puzzle workflows still boot.
Revisit when: the alpha ends. Once the catalog needs to live in Mongo (multiple concurrent puzzles, per-puzzle scheduling, admin tooling), drop sequential cycling and route each WebSocket connection to a chosen puzzle.

### 2026-05-12, backend-realtime, snap by origin equality

Choice: at drop time, the server collects grid-neighbor groups whose `worldX, worldY` is within `snapTolerance` of the dropped group's, picks the target origin (a locked candidate when present, otherwise the first), then merges only the candidates also within `snapTolerance` of that target. No per-piece offset math.
Why: canonical offsets are puzzle-global (`col*pieceSize, row*pieceSize`), so two clusters are aligned exactly when their group origins are equal, which keeps snap detection to coordinate comparisons. The target-filter pass is required because two candidates can each be within tolerance of the dropped group while being up to `2 * snapTolerance` apart from each other and from the target the merge snaps everything onto.
Revisit when: rotation is enabled (origins no longer suffice; will need per-edge alignment) or canonical offsets stop being puzzle-global.

### 2026-05-12, backend-realtime, docker all workspace deps

Choice: the server Docker image runs `npm ci --omit=dev` at the repo root, installing runtime deps for every workspace including the frontend, rather than scoping to `@mpp/server` and `@mpp/shared`.
Why: monorepo workspace filtering with `npm ci` is brittle (lockfile drift, missing peer resolution). Installing everything is one line, deterministic, and the image still excludes dev deps.
Revisit when: image size or cold-start time matters (Phase 1+ deploys). Switch to a server-only install or split lockfiles per workspace.

### 2026-05-12, shared-protocol, piece geometry not on the wire

Choice: piece silhouettes and canonical offsets are recomputed from `generationSeed` on both sides, never serialized.
Why: at 1M pieces, geometry would dominate payload size. Seed-based determinism keeps state minimal and timelapse replay tractable.
Revisit when: never expected. If the generator becomes non-deterministic across platforms (FP drift), pin to a fixed integer-math implementation rather than start shipping geometry.

### 2026-05-12, frontend-canvas, Vite puzzle assets

Choice: in dev, a Vite middleware in `packages/frontend/vite.config.ts` serves `<repo>/generated/<MPP_PUZZLE_ID:default test>/` at `/puzzle/*`. In `vite build`, a companion plugin (`mpp:bundle-puzzle`) copies the same directory into `dist/puzzle/` so Cloudflare Pages ships the manifest and tiles as static assets. The frontend always fetches `/puzzle/manifest.json` and tiles relative to it.
Why: keeps `generated/` as the single source of truth on disk, avoids checking copied artifacts into `packages/frontend/public/`, and gives both the dev server and the Pages build the same URL contract.
Revisit when: production points the frontend at R2 (Phase 1). Both the middleware and the build-time copy can be removed once tiles live on a CDN.

### 2026-05-12, frontend-canvas, bounding rect hits

Choice: each piece's interactive area is the Pixi container default (children bounds), which for a masked Sprite is the sprite's full bounding rect (tileSize square), not the visible silhouette. In overlap zones between adjacent unmerged pieces, clicks may pick either piece; topmost (z-order) wins.
Why: silhouette-shaped hit testing requires a custom `hitArea.contains` walking the cubic Bezier polygon. The bounding-rect default ships immediately and is good enough on a freshly shuffled board where pieces rarely overlap visibly.
Revisit when: overlap zones produce confusing pickups in practice, or once pieces start clustering. A `Polygon` hitArea sampled from the silhouette path is the natural follow-up.

### 2026-05-12, frontend-canvas, drag no throttle

Choice: every `pointermove` while a piece is held emits a `drag` WS message. No coalescing.
Why: simplest correct behavior. At Phase 0 (one client, low-rate mice) bandwidth is irrelevant, and the server already serializes messages.
Revisit when: high-rate mice (240Hz+) or many concurrent draggers create WS backpressure. Coalesce to one message per `requestAnimationFrame` tick and send the last point.

### 2026-05-12, frontend-canvas, cascade deferred

Choice: the cascade entrance animation is removed from Phase 0 and moved to Phase 2. The Phase 2 frontend-canvas entry describes it as a synchronized event-start cinematic, with pre-reqs in shared-protocol (`eventStartsAt` in welcome) and frontend-shell (landing countdown).
Why: the product vision is an event with a countdown on the landing page: at t=0 the canvas opens and every client plays the same cascade simultaneously, conveying scale and hype. Late joiners skip it. None of that is testable in Phase 0 (no event scheduling, no countdown, no synchronized trigger), and a local "play on /play open" cascade would be rewritten when the real trigger lands. Phase 0 ships without cascade; the other animations (snap, end-of-puzzle) still carry the "feel alive" pillar.
Revisit when: starting Phase 2, or earlier if the Phase 1 alpha would benefit from a dry-run of the event-start ritual. Implementation will be a one-shot Pixi ticker animation triggered when `Date.now() >= eventStartsAt - bufferMs` and the client has just connected.

### 2026-05-14, backend-realtime, global serial dispatch queue

Choice: every incoming WS message and disconnect cleanup, across all clients, goes through one process-wide `SerialQueue` (`queue.ts`): tasks run to completion in FIFO order, one at a time.
Why: handlers `await` Redis between reads and writes; without serialization two messages can interleave on those points and corrupt group state. A single chain makes the "server processes messages sequentially" invariant literally true with no locking logic.
Revisit when: the writer path needs more than one instance. The guarantee is per process, so horizontally scaling the WS writer breaks it. Only the drop/merge path (`handleDrop` -> `applyMerge`, a non-atomic read-modify-write across many Redis calls) depends on it: `grab` is already atomic Lua, `drag` and `hello` do not mutate. The architecture assumes a single writer instance (reads and broadcasts scale separately, per the CLAUDE.md read/write split); when that no longer holds, the options are an atomic Lua merge, a distributed lock per canvas region, or write sharding by region. Within one process, the finer follow-up is per-group queues.

### 2026-05-15, infra-deploy, alpha fixtures committed

Choice: three puzzle outputs are committed under `generated/alpha-1/` (45 pieces), `generated/alpha-2/` (510 pieces), and `generated/alpha-3/` (2040 pieces). The server Docker image copies all three; the Vite build copies each into `dist/puzzles/<id>/`. Source images stay out of git; the deterministic AVIF outputs are what ships.
Why: Coolify clones the repo as the build context, with no host volumes or pre-build hooks. Baking the fixtures in is the simplest way to give the server its manifest list at boot and to give the Pages build the matching tiles, without requiring a registry, an R2 bucket, or sharp inside the runtime image. Three sizes give testers a quick warmup, a real session, and a stress puzzle.
Revisit when: the image pipeline produces and uploads the real puzzle to R2 (Phase 1 `image-pipeline` track). At that point, drop the `generated/alpha-*/` commits and the `COPY` lines, and switch the server and Pages build to fetch manifests from R2.

### 2026-05-18, frontend-shell, alpha passcode

Choice: the landing page asks for a passcode before navigating to `/play`. The expected value comes from `VITE_ALPHA_PASSCODE` (default `alpha`); a match writes a flag to `localStorage` and the router's `beforeEnter` on `/play` reads it. The WebSocket server does not validate the passcode.
Why: the alpha is "closed" in the sense of "not advertised", not "cryptographically gated". The goal is to keep stray search-engine traffic and random link-followers out, while invited testers paste the passcode once and never see it again. A frontend-only check is one composable plus a route guard; a server-validated invite token would be a new auth surface that we throw away when real auth lands in Phase 2.
Revisit when: the alpha opens beyond the known testers, the passcode leaks publicly, or auth-and-accounts begins. Validate an invite token on the server `hello` and reject WS connections without one.

### 2026-05-18, frontend-shell, dev controls

Choice: `/play` exposes two buttons (Reset puzzle, Complete & cycle) wired to new `dev_reset` and `dev_complete` WebSocket messages. Visibility is controlled by `VITE_DEV_BUTTONS` (default visible during the alpha). Server-side both messages are rejected with `dev_disabled` unless `MPP_DEV_ENABLED=1`. Both buttons are protected by a `confirm()` prompt because they affect every connected tester at once.
Why: testers need to skip between puzzles and reset a stuck board without operator intervention. Putting the controls on `/play` (rather than a hidden URL) keeps feedback loops short. The env gate exists so we can pull them in one redeploy when the alpha ends.
Revisit when: the alpha ends. Flip `MPP_DEV_ENABLED=0` on the server and `VITE_DEV_BUTTONS=0` on the frontend before any non-tester traffic lands.

### 2026-05-18, backend-realtime, WS hardening

Choice: the WebSocket server enforces four limits at the network boundary. (1) `verifyClient` rejects upgrades whose `Origin` header is not in `MPP_ALLOWED_ORIGINS` (comma-separated; default `*` with a boot warning). (2) `maxPayload` caps a single frame at `MPP_WS_MAX_PAYLOAD_BYTES` (default 64 KB), so `ws` rejects oversize frames before they reach `JSON.parse`. (3) A per-connection `TokenBucket` (capacity `MPP_WS_RATE_BURST`, refill `MPP_WS_RATE_TOKENS_PER_SEC`, defaults 400 / 200 per sec) is consumed once per inbound message; over-budget messages are dropped silently before the serial dispatch queue sees them. (4) `Hub.send` and `Hub.broadcast` close the connection with code 1013 ("Try Again Later") when `ws.bufferedAmount` exceeds `MPP_WS_BUFFERED_AMOUNT_LIMIT_BYTES` (default 4 MB), so a slow consumer cannot grow the writer's memory without bound.
Why: without these, a single client can CSRF-connect from any origin, send a 100 MB frame, flood drag messages at arbitrary rate, or stall on socket reads while the writer queues snap broadcasts forever. None of these are theoretical: a few lines of JS from any tab were enough before. Putting the four checks at the boundary keeps the handler code unchanged and the budgets all live in `config.ts`. Silent drop on rate overflow (no error frame) avoids amplifying a hostile client's traffic.
Revisit when: the load tests in `qa-and-load` run. Tune the burst/rate against measured legitimate drag bursts (240Hz mice during a multi-piece cluster drag). When the WS writer is sharded past one process, the per-connection bucket still works but a per-IP outer limit will become necessary (today there is none, and many connections from one IP can still saturate). When real auth lands, the Origin allowlist remains useful (it costs nothing) but is subsumed by token validation on the upgrade.

### 2026-05-18, infra-deploy, alpha topology

Choice: the alpha runs on a single Hetzner CX22 VPS (Ubuntu 22.04 LTS) with Coolify installed on the same host it deploys to ("This Machine" target). Coolify embeds Traefik, which issues Let's Encrypt certs over HTTP-01 for `coolify.millionpiecepuzzle.com` and `ws.millionpiecepuzzle.com`. The two A records are kept Cloudflare-proxy-off (grey cloud) so the HTTP-01 challenge reaches the VPS directly. The frontend is on Cloudflare Pages at `app.millionpiecepuzzle.com`; it connects to the WS server over `wss://ws.millionpiecepuzzle.com/`.
Why: simplest topology that satisfies the Phase 1 exit criterion (5 to 20 invited users, anonymous, 10k pieces target). One VPS, one orchestrator, one frontend host. No control-plane separation, no R2 yet, no Cloudflare-managed origin shielding on the WS path.
Revisit when: Phase 2 (public 1M). Two concrete moves are likely: move Coolify to its own small VPS so the workload host can be rebuilt without losing the control plane, and flip `ws.*` to Cloudflare-proxied with an Origin CA cert so the WS endpoint gains DDoS protection. Both are mechanical, but each adds moving parts that are not justified for the closed alpha.

### 2026-05-20, backend-realtime, viewport-scoped drag and drop broadcasts

Choice: drag and drop are broadcast only to clients whose last reported `viewport` rectangle contains the event point (`worldX, worldY`); snap stays a global broadcast. Scoping is point-based: the event origin is tested against each receiver's viewport, the dragged cluster's full extent is not computed. A client that has not sent a `viewport` message yet receives every drag and drop (fail-open).
Why: drag is high-frequency and never persisted, so a per-frame cluster bounding-box computation (read all group pieces, apply canonical offsets) is too heavy; the event origin is the only coordinate already on the wire. Fail-open keeps the server compatible with a frontend that does not yet send viewports and never silently starves a client of updates. Snap stays global because a lock is a puzzle-wide event (locked count, activity feed).
Revisit when: Phase 2 viewport sharding. Two known gaps: a large unlocked cluster whose origin sits off a peer's screen while its body overlaps it is missed (drag self-corrects within a frame once the origin crosses in, a single drop does not), and a peer panning into a region holds stale positions for non-merging drops it never received. Both are resolved by the Phase 2 move to viewport-scoped initial state plus incremental subscriptions.

### 2026-05-20, auth-and-accounts, anonymous pseudo on the session

Choice: the pseudo is an anonymous, client-chosen name validated by `normalizePseudo` in `shared` (trim, collapse spaces, 2 to 16 chars, letters/digits/space/hyphen/underscore). It is kept in `localStorage` on the client and on the WS connection (`Client.pseudo`) on the server, sent via the `setPseudo` message and re-sent on every `welcome`. It is never written to Mongo, so there is no uniqueness check. Live `SSnap` carries the snapper's pseudo so the activity feed shows real names; the `SActivity` backfill rebuilt from Mongo `ClusterMerge` keeps user ids.
Why: Phase 1 is anonymous by design, so a session-scoped pseudo is enough for activity attribution without a user store. Carrying the pseudo on each `SSnap`, rather than through a `join`/`leave` presence registry, makes a mid-session pseudo change take effect for free and keeps presence broadcasting (still unimplemented) out of this task. The backfill cannot recover past pseudos because they are not persisted; the resulting inconsistency (named live entries, user ids for backfilled ones) is accepted since backfilled entries scroll off within a few snaps.
Revisit when: Phase 2 auth lands. The pseudo moves to a Mongo user profile tied to a verified identity, `setPseudo` is replaced by the authenticated identity, and the activity backfill can resolve names from the user store.

### 2026-05-21, frontend-canvas, completion leaderboard scoring

Choice: the completion-modal leaderboard scores each piece one point, credited to the user of the first `ClusterMerge` (by `at`) whose `droppedPieceIds` lists it. `ClusterMerge` stores `droppedPieceIds`, the pieces of the group the user dragged in that merge, alongside `addedPieceIds` (the pieces whose group id changed, kept for client sprite re-parenting). Standings are derived on demand by a `cluster_merges` aggregation and sent as `SLeaderboard` on completion (and to a client joining an already-completed puzzle). Rows display a shortened `userId`, not a pseudo.
Why: a piece moves only when its group is dragged, and every piece starts shuffled and must be carried to its solved position (a misplaced cluster cannot be bridged into the solved structure, since a snap needs both sides already aligned within tolerance). So every piece is in some merge's dragged group at least once, and crediting the first such merge gives each piece exactly one point, with per-user totals summing to the full piece count. `droppedPieceIds` is the correct basis: `addedPieceIds` records the lower-group-id side of a merge, not the side the user dragged, so it would credit the stationary cluster when a low-id cluster is dragged onto a high-id target. Pseudos are not persisted (see [anonymous pseudo on the session](#2026-05-20-auth-and-accounts-anonymous-pseudo-on-the-session)), so the aggregation can only yield ephemeral user ids.
Revisit when: the aggregation unwinds and groups the full merge log, which will not scale to a 1M-piece puzzle; precompute a per-user counter then. When real auth lands, resolve names from the user store instead of showing user ids.

### 2026-05-20, shared-protocol, lockedDelta stored on ClusterMerge

Choice: `ClusterMerge` persists `lockedDelta`, the number of pieces a merge newly locked to the frame, even though stats are otherwise derived on demand.
Why: the activity feed backfill sends a per-merge "placed N pieces" count for anchoring events, and that count cannot be reconstructed from a saved merge. A frame-anchored cluster locks its pieces without listing any in `addedPieceIds` (those ids only ever hold pieces that changed group id), so the count is known only at merge time. It is a property of the event, not a precomputed per-user counter, so it does not conflict with deriving user stats on demand.
