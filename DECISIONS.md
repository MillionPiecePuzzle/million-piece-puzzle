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
- [Image pipeline emits rectangular tiles without silhouette mask](#2026-05-12-image-pipeline-rectangular-tiles) -> revisit if client-side masking shows up in render profiling at Phase 1+ scale.
- [Image pipeline derives `pieceSize` from image dimensions and center-crops](#2026-05-12-image-pipeline-adaptive-piecesize) -> revisit if non-centered crops or aspect-fitting become useful.
- [Snap detection compares group origins for equality within tolerance](#2026-05-12-backend-realtime-snap-by-origin) -> stable assumption; revisit only if canonical offsets stop being puzzle-global (e.g., rotation enabled).
- [Server Docker image installs all workspace runtime deps](#2026-05-12-backend-realtime-docker-all-workspace-deps) -> trim once image size matters.
- [Piece outline approximated by 8 cubic Beziers per curved edge](#2026-05-13-piece-generation-edge-path-topology) -> revisit if silhouettes look degenerate or if a tighter approximation is needed for snap visuals.
- [Piece hit testing uses the sprite bounding rect, not the mask silhouette](#2026-05-12-frontend-canvas-bounding-rect-hits) -> revisit once overlap zones between adjacent unmerged pieces produce confusing pickups.
- [Drag broadcasts sent on every pointermove without throttling](#2026-05-12-frontend-canvas-drag-no-throttle) -> coalesce with requestAnimationFrame once the WS shows backpressure or high-rate mice flood the server.
- [Global serial dispatch queue for all WS messages](#2026-05-14-backend-realtime-global-serial-dispatch-queue) -> per-process total order; scaling the writer past one instance needs an atomic Lua merge, a regional lock, or write sharding.
- [Cascade entrance animation descoped from Phase 0 to Phase 2](#2026-05-12-frontend-canvas-cascade-deferred) -> requires event scheduling (`eventStartsAt`) and a landing countdown to be meaningful; building it now would mean rebuilding it twice.
- [Closed-alpha gate is a frontend-only passcode](#2026-05-18-frontend-shell-alpha-passcode) -> replace with a server-validated invite token (or full auth) before opening the alpha beyond known testers.
- [Dev controls (place/reset/complete) exposed on /play, server-gated by env var](#2026-05-18-frontend-shell-dev-controls) -> set `MPP_DEV_ENABLED=0` and `VITE_DEV_BUTTONS=0` before the first non-tester users land.
- [Alpha topology: single VPS, Coolify on the workload host, Cloudflare DNS-only for `ws.*`](#2026-05-18-infra-deploy-alpha-topology) -> split Coolify control plane from workload, and consider Cloudflare-proxied origin or R2 fronting, before Phase 2 public traffic.
- [WS hardening: Origin allowlist, per-IP token bucket and connection cap, frame size cap, backpressure close](#2026-05-18-backend-realtime-ws-hardening) -> tune limits once load tests run; move the per-IP registry to shared state if the writer is sharded.
- [Drag and drop broadcasts scoped to the receiver viewport](#2026-05-20-backend-realtime-viewport-scoped-drag-and-drop-broadcasts) -> Phase 2 viewport sharding plus incremental subscriptions.
- [Anonymous pseudo lives on the session, not in Mongo](#2026-05-20-auth-and-accounts-anonymous-pseudo-on-the-session) -> Phase 2 moves it to a verified Mongo user profile with real auth.
- [Leaderboard scored from the full ClusterMerge log, re-run per anchoring snap](#2026-05-21-frontend-canvas-leaderboard-scoring) -> precompute a per-user counter at 1M scale.
- [Frustum culling only, no zoom-out LOD](#2026-05-21-frontend-canvas-frustum-culling-without-zoom-out-lod) -> Phase 2 aggregated-tile LOD makes the fully-zoomed-out view affordable.
- [Board bounded by a server-computed play zone, camera and pieces clamped to it](#2026-05-21-frontend-canvas-play-zone-hard-limits) -> Phase 2 needs server-side position validation and revisits the bound under viewport sharding.
- [Spectator snapshot is a full payload served from the WS host with a short edge cache](#2026-05-23-backend-realtime-spectator-snapshot-full-from-host) -> at 1M-piece scale switch to a keyframe + event-log diff stream (see ROADMAP backlog).
- [Spectator snapshot fronted by a dedicated Cloudflare-proxied hostname](#2026-05-23-infra-deploy-snapshot-proxied-hostname) -> revisit when `ws.*` itself moves to proxied (Phase 2) and the two endpoints can share a host again.
- [Load harness PASS criterion bounded to saturation signals, not absolute latency](#2026-05-28-qa-and-load-harness-pass-criterion-bounded-to-saturation-signals) -> reintroduce a latency budget once Phase 2 perf work (drag throttling, per-group queues, write sharding) lands.

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

### 2026-05-12, image-pipeline, rectangular tiles

Choice: the slicer emits square AVIF tiles of `pieceSize + 2 * margin` pixels centered on each grid cell, without applying a bezier silhouette mask. The frontend will mask client-side at render time during track `frontend-canvas`.
Why: keeps the param-to-Bezier-path work in one place (the renderer), avoids tuning silhouettes before we have a visual feedback loop, and makes silhouette changes free to iterate without re-running the pipeline.
Revisit when: client-side masking shows up in profiling at Phase 1 (10k pieces) or Phase 2 (1M). Pre-mask on the server side and upload alpha-cut AVIFs to R2.

### 2026-05-12, image-pipeline, tile margin

Choice: tile margin defaults to `round(0.35 * pieceSize)`, just above the max `depth` param (0.30) of the generator.
Why: ensures tabs always fit inside the tile with a small safety buffer.
Revisit when: edge param ranges widen, or rotation is enabled (tabs may then point in unexpected directions and the margin assumption changes).

### 2026-05-12, image-pipeline, adaptive pieceSize

Choice: `--piece-size` is optional. When omitted, the script derives `pieceSize = floor(min(width/cols, height/rows))` from the source image and center-crops the puzzle area to `cols*pieceSize` by `rows*pieceSize`. Any leftover band on the longer axis is discarded.
Why: the user wants to drop any image and have the pipeline adapt, not the other way around. Center-crop keeps the visually important center of the image.
Revisit when: a workflow needs to preserve the full image (no crop), align the puzzle to a non-center anchor, or use non-square pieces.

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

### 2026-05-18, frontend-shell, alpha passcode

Choice: the landing page asks for a passcode before navigating to `/play`. The expected value comes from `VITE_ALPHA_PASSCODE` (default `alpha`); a match writes a flag to `localStorage` and the router's `beforeEnter` on `/play` reads it. The WebSocket server does not validate the passcode.
Why: the alpha is "closed" in the sense of "not advertised", not "cryptographically gated". The goal is to keep stray search-engine traffic and random link-followers out, while invited testers paste the passcode once and never see it again. A frontend-only check is one composable plus a route guard; a server-validated invite token would be a new auth surface that we throw away when real auth lands in Phase 2.
Revisit when: the alpha opens beyond the known testers, the passcode leaks publicly, or auth-and-accounts begins. Validate an invite token on the server `hello` and reject WS connections without one.

### 2026-05-18, frontend-shell, dev controls

Choice: `/play` exposes three buttons (Place piece, Reset puzzle, Complete) wired to `dev_place`, `dev_reset` and `dev_complete` WebSocket messages. `dev_reset` wipes and re-initializes the current puzzle (and clears its merge log, so the leaderboard and activity feed start empty); `dev_complete` jumps the locked count to the total, flips the meta status to `completed`, and logs one merge crediting the executing client for every piece not already attributed; `dev_place` anchors one random cluster. Visibility is controlled by `VITE_DEV_BUTTONS` (default visible during the alpha); within that, the controls show in any session mode, not just contributor. They send over the WebSocket, so clicking one in spectator mode upgrades the session to a contributor connection and the message is queued and flushed on `welcome`. Server-side every dev message is rejected with `dev_disabled` unless `MPP_DEV_ENABLED=1`. Reset and Complete are protected by a `confirm()` prompt because they affect every connected tester at once.
Why: testers need a way to exercise the end-of-puzzle UI and to reset a stuck board without operator intervention. Putting the controls on `/play` (rather than a hidden URL) keeps feedback loops short. The env gate exists so we can pull them in one redeploy when the alpha ends.
Revisit when: the alpha ends. Flip `MPP_DEV_ENABLED=0` on the server and `VITE_DEV_BUTTONS=0` on the frontend before any non-tester traffic lands.

### 2026-05-18, backend-realtime, WS hardening

Choice: the WebSocket server enforces five limits at the network boundary. (1) `verifyClient` rejects upgrades whose `Origin` header is not in `MPP_ALLOWED_ORIGINS` (comma-separated; default `*` with a boot warning). (2) `maxPayload` caps a single frame at `MPP_WS_MAX_PAYLOAD_BYTES` (default 64 KB), so `ws` rejects oversize frames before they reach `JSON.parse`. (3) A per-IP `TokenBucket` (capacity `MPP_WS_RATE_BURST`, refill `MPP_WS_RATE_TOKENS_PER_SEC`, defaults 400 / 200 per sec) is consumed once per inbound message; over-budget messages are dropped silently before the serial dispatch queue sees them. (4) An `IpRegistry` caps concurrent connections per IP at `MPP_WS_MAX_CONNECTIONS_PER_IP` (default 10); a connection over the cap is closed with code 1013 before it is added to the hub. (5) `Hub.send` and `Hub.broadcast` close the connection with code 1013 ("Try Again Later") when `ws.bufferedAmount` exceeds `MPP_WS_BUFFERED_AMOUNT_LIMIT_BYTES` (default 4 MB), so a slow consumer cannot grow the writer's memory without bound. The rate bucket and connection count are keyed by client IP and shared across all of an IP's connections through the `IpRegistry`, whose entry is created on the first connection and deleted when the last one closes. The IP is read from the `CF-Connecting-IP` header set by Cloudflare (`socket.remoteAddress` is the edge, not the client), falling back to `socket.remoteAddress` in dev and to a shared `unknown` key for a production request that did not arrive through the edge.
Why: without these, a single client can CSRF-connect from any origin, send a 100 MB frame, flood drag messages at arbitrary rate, open unbounded parallel sessions to multiply its rate budget, or stall on socket reads while the writer queues snap broadcasts forever. None of these are theoretical: a few lines of JS from any tab were enough before. Keying the rate bucket and connection cap by IP rather than by connection means opening more sessions cannot raise an IP's aggregate message rate or socket count, which a per-connection bucket alone allowed. Putting the checks at the boundary keeps the handler code unchanged and the budgets all live in `config.ts`. Silent drop on rate overflow (no error frame) avoids amplifying a hostile client's traffic.
Revisit when: the load tests in `qa-and-load` run. Tune the burst/rate and the connection cap against measured legitimate usage (240Hz mice during a multi-piece cluster drag; testers behind one shared NAT count against a single IP budget, so the cap may need raising). Trusting `CF-Connecting-IP` assumes ingress is restricted to Cloudflare: a direct-to-origin client can spoof the header, so the deployment must firewall the origin to Cloudflare ranges (the alpha leaves this open). The per-IP key is per address, so an IPv6 client with a wide prefix can rotate addresses to evade the cap; bucket by `/64` if that shows up. The `IpRegistry` lives in one process, so sharding the WS writer needs the count moved to shared state (e.g. Redis). When real auth lands, the Origin allowlist remains useful (it costs nothing) but is subsumed by token validation on the upgrade.

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

### 2026-05-21, frontend-canvas, leaderboard scoring

Choice: the leaderboard scores each piece one point, credited to the user of the first `ClusterMerge` (by `at`) whose `droppedPieceIds` lists it. `ClusterMerge` stores `droppedPieceIds`, the pieces of the group the user dragged in that merge, alongside `addedPieceIds` (the pieces whose group id changed, kept for client sprite re-parenting). Standings are derived on demand by a `cluster_merges` aggregation, broadcast after every anchoring snap and sent to each client on join, so the in-game leaderboard panel and the completion modal both stay live. Rows display a shortened `userId`, not a pseudo.
Why: a piece moves only when its group is dragged, and every piece starts shuffled and must be carried to its solved position (a misplaced cluster cannot be bridged into the solved structure, since a snap needs both sides already aligned within tolerance). So every piece is in some merge's dragged group at least once, and crediting the first such merge gives each piece exactly one point, with per-user totals summing to the full piece count. `droppedPieceIds` is the correct basis: `addedPieceIds` records the lower-group-id side of a merge, not the side the user dragged, so it would credit the stationary cluster when a low-id cluster is dragged onto a high-id target. Pseudos are not persisted (see [anonymous pseudo on the session](#2026-05-20-auth-and-accounts-anonymous-pseudo-on-the-session)), so the aggregation can only yield ephemeral user ids.
Revisit when: the aggregation unwinds and groups the full merge log; re-running it on every anchoring snap will not scale to a 1M-piece puzzle, so precompute a per-user counter then. When real auth lands, resolve names from the user store instead of showing user ids.

### 2026-05-20, shared-protocol, lockedDelta stored on ClusterMerge

Choice: `ClusterMerge` persists `lockedDelta`, the number of pieces a merge newly locked to the frame, even though stats are otherwise derived on demand.
Why: the activity feed backfill sends a per-merge "placed N pieces" count for anchoring events, and that count cannot be reconstructed from a saved merge. A frame-anchored cluster locks its pieces without listing any in `addedPieceIds` (those ids only ever hold pieces that changed group id), so the count is known only at merge time. It is a property of the event, not a precomputed per-user counter, so it does not conflict with deriving user stats on demand.

### 2026-05-21, frontend-canvas, frustum culling without zoom-out LOD

Choice: the canvas culls groups and pieces outside the viewport by toggling Pixi's `culled` flag, recomputed on every camera change, resize, and group move. Culling is two-level: a group whose world AABB misses the viewport is culled whole; a group that intersects has each piece tested individually, so a large partially-visible cluster renders only its on-screen pieces. Bounds are analytic (canonical offset plus one margin per piece, unioned per group), never `getBounds`. There is no level-of-detail: pieces keep their silhouette mask at every zoom.
Why: culling removes the per-piece stencil and draw-call cost for off-screen pieces, which keeps the zoomed-in playing experience smooth at 10 000 pieces. It does nothing when the whole board is on screen (fully zoomed out), where every piece is visible and every mask still renders, so that view stays heavy. Phase 1 accepts this because contributors play zoomed in, and a Phase 1 LOD would be throwaway work once the Phase 2 aggregated-tile LOD replaces per-piece sprites on zoom-out.
Revisit when: Phase 2. The "Zoom-out LOD uses aggregated tiles instead of per-piece sprites" task makes the fully-zoomed-out view affordable and is the home for all zoom-out level-of-detail.

### 2026-05-21, frontend-canvas, play-zone hard limits

Choice: the board is bounded by a play zone, computed once on the server (`playZoneForManifest` in `init.ts`) as the AABB of the puzzle frame unioned with every piece at its initial scattered position, then widened by a margin (50% of its larger side), mirrored around the frame center, and with the symmetric half-extent snapped outward to the world grid cell (`GRID_WORLD_CELL`, 80, in `@mpp/shared`). The server sends the zone in the `welcome` message, so every client of a puzzle enforces the exact same bound regardless of join time. The camera is clamped to the play zone expanded by a padding ring (4% of its larger side); when the viewport is larger than that limit on an axis it centers instead. Held pieces are clamped at drag and drop input so no piece can leave the zone. The area outside is darkened by a world-space fill carrying a coarse checkerboard, a distinct motif from the hairline grid inside. The minimap canvas adopts the zone's aspect ratio (clamped) and insets the zone within a thin out-of-bounds band, so the map fills the panel with no letterbox and the outside reads on every edge. Minimum zoom is raised from 5% to 15%.
Why: computing the zone on the server makes it a single authoritative value. A per-client computation from join-time positions would give late joiners a smaller zone, since pieces drift inward as the puzzle is solved: a piece dragged to an early client's zone edge would land outside a late client's bound, unreachable in the dark backdrop, with camera limits and minimap extent diverging between clients. The zone is a pure function of the manifest seed, so the server computes it once at boot in `PuzzleLifecycle` rather than storing it. The margin gives pieces scattered against the raw bound room to be dragged outward; the zone still never needs to grow, since the clamp keeps every piece inside the padded bound (a drag is clamped, a merge lands within existing pieces). Mirroring the bound around the frame center keeps the puzzle frame dead-center in the minimap and gives the camera symmetric pan limits; snapping the symmetric half-extent to the grid cell lands the backdrop boundary on a grid line when the frame center is itself grid-aligned (the 1M board). The piece clamp is client-side only, since the WS server does not validate positions, consistent with the closed alpha's honest-client assumption. The 15% zoom floor bounds the visible piece count, so a large board no longer fits entirely on screen.
Revisit when: a malicious client sends out-of-zone positions (move the clamp server-side then), or Phase 2 viewport sharding changes how the world is bounded.

### 2026-05-23, image-pipeline, reference image as a Deep Zoom pyramid

Choice: the slicer writes the center-cropped puzzle area as a Deep Zoom pyramid (`source.dzi` plus `source_files/<level>/<x>_<y>.webp`) next to the manifest, produced by sharp's `tile({ layout: "dz" })` (libvips under the hood). `manifest.source.dzi` points at the `.dzi` descriptor; `width` and `height` are the cropped dimensions (`cols*pieceSize` by `rows*pieceSize`). The frontend reference panel opens the DZI directly with OpenSeadragon. Tiles are WebP, 254 px with 1 px overlap.
Why: one format covers both the alpha-scale source (a few MP) and the Phase 2 gigapixel source. WebP tiles keep the per-tile payload small, and OpenSeadragon only fetches the levels and tiles the viewport needs, so a multi-gigapixel source costs the same to display as a small one. A single full-resolution AVIF would have to be downloaded entirely just to show the reference panel, which does not scale past the alpha. The DZI overhead at small sizes is a few extra files and roughly the same total bytes.
Revisit when: another consumer needs a single full-resolution reference image (e.g. a server-side thumbnail generator); ship that consumer's needs separately rather than re-adding `source.avif` to the manifest.

### 2026-05-22, infra-deploy, single R2 bucket for tiles and pieces

Choice: tiles (Deep Zoom pyramid) and per-piece AVIF textures share one R2 bucket (`mpp-assets`), separated by key prefix (`tiles/`, `pieces/`). The bucket is exposed read-only over a Cloudflare custom domain (`assets.millionpiecepuzzle.com`), which also fronts it with the Cloudflare CDN; the `r2.dev` URL stays disabled. CORS allows `GET` and `HEAD` from the Pages origin and the local dev origin.
Why: both asset sets come from the same image-pipeline run on the same source image and are immutable once published, so they share one lifecycle and identical caching needs; separate buckets would only add a second domain and CORS policy to maintain for no operational gain. A custom domain (instead of `r2.dev`) gives proper CDN cache control and no rate limit, which Cloudflare requires for production.
Revisit when: an asset set needs an independent cache TTL or access policy.

### 2026-05-23, backend-realtime, spectator snapshot full from host

Choice: spectator mode is fed by `GET /snapshot` on the WS host. A ticker (`MPP_SNAPSHOT_INTERVAL_MS`, default 2000) regenerates a full JSON payload (`puzzleId`, `generatedAt`, `lockedCount`, `playZone`, `pieces`, `groups`) in memory; the endpoint serves the cached body with `Cache-Control: public, max-age=<interval seconds>` so the Cloudflare edge absorbs spectator traffic. No R2 push: the host is the source of truth and a transient Redis hiccup keeps the last good body served rather than producing a 5xx.
Why: read/write split for scaling without coupling spectators to the WS message rate. Serving from the host avoids an extra R2 write per tick and lets the snapshot live as long as the process does, even when the CDN cannot reach origin. Full payload (not a diff) is trivial to implement and verifiable end to end at alpha scale (~300 KB gzipped at 10k pieces).
Revisit when: Phase 2 at 1M pieces, where a full snapshot would balloon past ~25 MB gzipped per tick. Move to a keyframe + event-log diff stream with client-side position interpolation (ROADMAP backlog: "Spectator stream: keyframe + event-log diffs with client-side interpolation"). Also revisit if WS-host availability becomes the bottleneck: pushing the snapshot to R2 decouples spectator availability from the writer process.

### 2026-05-23, infra-deploy, snapshot proxied hostname

Choice: spectator traffic uses a dedicated hostname `snapshot.millionpiecepuzzle.com`, proxied through Cloudflare (orange cloud), pointing at the same Coolify service as the WS host. `ws.millionpiecepuzzle.com` stays DNS-only. A Cloudflare Cache Rule scoped to `(http.host eq "snapshot.millionpiecepuzzle.com" and http.request.uri.path eq "/snapshot")` sets cache eligibility to "Eligible for cache", edge TTL to "Respect origin", and enables "Serve stale content while updating" so a regeneration overrun never returns origin errors to viewers. The Node `/snapshot` handler hardcodes `Access-Control-Allow-Origin: *`, independent of the WS `MPP_ALLOWED_ORIGINS` allowlist which stays strict.
Why: flipping `ws.*` to proxied would have contradicted the alpha-topology decision below and added a CF hop on every live WS frame in the middle of the alpha; a second hostname leaves WS untouched and isolates the cert and cache lifecycle. A path-scoped Cache Rule keeps any future endpoints under the same host (`/healthz`, future R2-fronted assets) uncached by default. CORS on `/snapshot` is wildcard because the payload is anonymous read-only puzzle state intentionally fronted by a shared CDN: a per-origin echo with `Vary: Origin` would cache-poison on Cloudflare Free (which does not honor Vary for caching), and an `Origin` header is trivially spoofed outside browsers so it is not a meaningful security boundary for an HTTP read endpoint. The WS Origin allowlist is a separate concern (anti-CSWSH from third-party tabs) and stays specific.
Revisit when: `ws.*` itself moves to proxied (Phase 2 mechanical step in the alpha-topology entry). At that point fold spectator traffic back onto the WS host and retire the dedicated hostname, or keep it for cache isolation if Cache Rules prove brittle to scope by path.

### 2026-05-23, image-pipeline, piece tiles bucketed by hundreds

Choice: the slicer writes piece tiles to `pieces/<bucket>/<id>.avif`, where `bucket = floor(id / 100)` zero-padded to 4 digits and `id` zero-padded to the width of the largest piece id. Each entry's `file` in the manifest carries the bucketed path verbatim; the frontend never reconstructs it from `id`. The slicer is the only path that emits AVIF, so there is no flat layout to maintain in parallel.
Why: at 1M pieces, a single flat `pieces/` directory holds a million entries, which slows `ls`, R2 listings, and any human inspection of the layout. Splitting by hundreds gives ~10 000 directories with up to 100 files each at full scale, both numbers comfortable to enumerate. Bucket size 100 is a round middle ground: 10 (too deep at 1M, 100 000 dirs) and 1000 (too wide per dir at full scale, complicates inspection) are the obvious neighbors. Padding the bucket index to 4 digits keeps directory names sorted lexicographically and matches the worst case at 1M pieces (`0000` to `9999`). The manifest stores the resolved path so the convention can change without a frontend release.
Revisit when: never expected at this granularity. If the puzzle grows past 1M pieces, widen the bucket index padding rather than change the divisor.

### 2026-05-23, backend-realtime, manifest fetched from R2 at boot

Choice: the server reads `MPP_PUZZLE_ID` and `MPP_ASSETS_BASE_URL`, fetches `<base>/<id>/manifest.json` with the global `fetch()` once at boot, and aborts the process on any network error, non-2xx response, or `puzzleId` mismatch. There is no local fallback, no retry loop, and no manifest cache on the host filesystem. The previous `MPP_MANIFEST` path-based env is removed.
Why: a single source of truth for the alpha asset set is the R2 bucket fronted by `assets.millionpiecepuzzle.com`. Removing the on-disk copy in the runtime image removes a class of skew bug (image baked with one manifest, R2 holding another) and reuses the bucket already needed for the per-piece tiles, so the server, the frontend, and the Pages build all read the same files. Fail-fast at boot turns a missing or wrong manifest into an immediate restart loop visible to Coolify, instead of a half-initialized process serving a stale puzzle. The host is allowed to depend on R2 at boot because the R2 custom domain (`assets.*`) is fronted by the Cloudflare CDN and serves an immutable artifact: a cold cache miss is one origin GET, after which the edge serves further restarts. Once Redis is initialized for a given puzzle id the running process no longer needs R2.
Revisit when: the boot-time R2 read becomes a deploy hazard (extended Cloudflare or R2 incident overlapping a deploy). The cheapest mitigation is to keep the last successful manifest on a small persistent volume and read it as a fallback; a heavier one is to publish manifests immutably under a version suffix and pin the env to that version.

### 2026-05-28, qa-and-load, harness PASS criterion bounded to saturation signals

Choice: the load harness flags PASS when (1) no WebSocket close with code 1013 (backpressure) occurred, (2) no `ws` library errors were raised on any bot, and (3) server `error` frames stay below 5% of grab attempts. Grab round-trip latency is reported (p50/p95/p99/max) but not gated.
Why: the Phase 1 exit criterion for this task is "without server saturation", which is the closes/errors/drops dimension. On the alpha CX22 fronted by Cloudflare, the 20-bot/300s baseline against prod recorded p95=3.9s, p99=4.6s, and 24.7% client-side grab timeouts at 5s, while raising zero backpressure closes, zero ws errors, and zero server errors. That multi-second latency is bounded by the architecture itself, not by a load-induced fault: the [global serial dispatch queue](#2026-05-14-backend-realtime-global-serial-dispatch-queue) processes every message in one chain, the [unthrottled per-pointermove drag broadcast](#2026-05-12-frontend-canvas-drag-no-throttle) fans out roughly 6 000 outbound writes per second on a sustained 300 drag/s ingest, and the WS writer is a single Node process per the [alpha topology](#2026-05-18-infra-deploy-alpha-topology). Gating PASS on an absolute latency budget would conflate two questions: does the server stay up under load (yes, the harness covers this), and is each interaction snappy (no, and a Phase 2 problem). Keeping the harness focused on saturation lets the verdict track the deployment health it was built to verify and leaves the latency story to its own follow-up.
Revisit when: Phase 2 perf work lands (drag throttling, per-group queues replacing the global one, write sharding, or the WS writer split off a single process). Re-run the harness with a latency budget appropriate to the new architecture and tighten the PASS criterion accordingly.

### 2026-05-28, backend-realtime, scatter as a detached center-dense rounded-square band

Choice: the initial scatter samples each piece body (origin + canonicalOffset) in a rounded-square band detached from the frame, then sets the group origin to body - canonicalOffset. The band lies between two superellipses sharing the frame aspect, exponent `SCATTER_SHAPE_EXPONENT` (4, a rounded square): an inner gap scaled by `SCATTER_GAP_SCALE` (1.4) and an outer halo scaled by `SCATTER_HALO_SCALE` (2.8), both relative to the clear rectangle (frame grown by half a piece) and both >= 2^(1/4) so they enclose it. Each placement draws an angle and a triangular radius across the band (mean of two uniforms, three RNG draws), peaking mid-band and fading to both edges.
Why: pieces render at `origin + canonicalOffset`, and `canonicalOffset` is the solved cell (`col*pieceSize, row*pieceSize`). Randomizing the origin alone left the solved image in place plus bounded jitter (sky pieces high, ground low); randomizing the body instead decouples the shuffled layout from the solved one. The gap leaves empty space around the assembly area so the cloud reads as detached from the canvas, and the triangular radius makes it dense in the middle of the band and dispersing on both sides, like a tipped-out packet of pieces, rather than a uniform band hugging the frame.
Revisit when: the gap around the frame is too small or too large (`SCATTER_GAP_SCALE`), the cloud is too dense or too sparse (`SCATTER_HALO_SCALE`), or the corners read too round or too square (`SCATTER_SHAPE_EXPONENT`).

### 2026-05-28, frontend-canvas, reference viewers forced to the canvas drawer

Choice: both OpenSeadragon viewers (the sidebar reference thumbnail and the enlarged modal) are created with `drawer: "canvas"` instead of OpenSeadragon 6's default WebGL drawer. The sidebar viewer is also kept a sibling of its click target rather than nested inside the `<button>`, since nesting it leaves the viewer blank.
Why: the play page already runs the PixiJS stage's WebGL context for the pieces. Alongside it, OpenSeadragon's WebGL drawer fails its tile texture uploads ("Error creating texture in WebGL"), leaving the viewer blank. The context2d drawer renders one Deep Zoom image with no measurable cost, so the reference views are reliable regardless of the page's WebGL pressure.
Revisit when: OpenSeadragon's WebGL drawer stops contending with PixiJS (a shared GL context, an OSD fix, or moving the reference views off the play page), at which point the default drawer can be restored for its faster pan/zoom.
