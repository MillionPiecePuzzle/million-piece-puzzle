# Decisions

Running log of non-obvious development choices. Each entry: the choice, the rationale, and (when relevant) the scale at which it must be revisited.

When a decision is refined, edit its entry in place so it always describes the current choice. When a decision is fully superseded, delete the stale entry rather than layering "supersedes" notes on top of it. The log should read as what is true now, not as a history of what changed.

Keep every entry skimmable: 1-3 sentences per field. Config defaults live in `config.ts` / `.env.example`, not here; alternatives considered and rejected get a phrase, not a paragraph. If an entry starts running long, it is drifting from the point of this file. A decision that is purely local tooling detail (a workaround for a bug in a library or a dev machine, with no product or architecture consequence) belongs as a code comment where the workaround lives, not here.

## Format

```
### YYYY-MM-DD, track, short title
Choice: what was decided.
Why: the reason.
Revisit when: trigger that should force a rethink (optional)
```

---

## Revisit-later index

Quick scan of choices with a genuine open trigger: something not yet resolved and still worth checking. Reviewed 2026-07-09 against the finished roadmap: a real public launch (the real photo, an advertised URL) is still the plan, so what remains below is gated on that launch, on the one open ROADMAP backlog item (firewalling the origin), or on live public traffic to tune a default against. Every other trigger this index used to carry was either already answered by an existing mechanism or a hypothetical with no planned path to occur; each was resolved directly in its own entry and dropped from this index.

- [Dev controls on /play, env-gated](#2026-05-18-frontend-shell-dev-controls) -> confirmed still on in prod as of 2026-07-09; flip both flags before the real photo goes live.
- [Alpha topology: single VPS, origin not firewalled to Cloudflare](#2026-05-18-infra-deploy-alpha-topology) -> the one open item in the ROADMAP backlog; close the DDoS gap.
- [WS hardening: Origin allowlist, per-IP caps, backpressure close](#2026-05-18-backend-realtime-ws-hardening) -> tied to the same open firewall gap; `CF-Connecting-IP` is spoofable until it closes.
- [Server-computed minimap grid, maintained incrementally](#2026-06-06-backend-realtime-server-computed-minimap-grid) -> 24h resync interval is an unmeasured default, tune once there is live data.
- [Per-tile piece cap on non-merging drops](#2026-06-11-backend-realtime-per-tile-piece-cap-on-non-merging-drops) -> tune the 8x multiplier from live usage.
- [Leaderboard scored live from the full merge log](#2026-05-21-frontend-canvas-leaderboard-scoring) -> the puzzle is now actually at 1M scale, not a future one; worth checking whether the per-snap aggregation shows up in live latency.
- [Hot-tile residency frees covered-cold clusters](#2026-06-05-frontend-canvas-hot-tile-residency-frees-covered-cold-clusters) -> tune the piece budget and hot TTL from real usage.
- [Soak-test validator + per-bot IP spoofing](#2026-06-19-qa-and-load-soak-test-state-corruption-validator-and-per-bot-ip-spoofing) -> the IP spoof rides the open firewall gap above; closing it moves the spoof inside the edge.
- [Grab reservation race and stale-hold sweep](#2026-07-05-backend-realtime-grab-reservation-race-and-stale-hold-sweep) -> `MPP_STALE_HOLD_MS` is an unmeasured heuristic; tune from observed live hold durations.
- [Paced region_state batching](#2026-07-06-backend-realtime-paced-region_state-batching) -> batch size and poll interval held clean through one re-soak; real public traffic could still exceed that.
- [Edge uniqueness validated per-seed](#2026-06-09-piece-generation-edge-uniqueness-validated-per-seed) -> still pending: the production seed is for the real photo, which has not replaced the synthetic placeholder yet.
- [Anti-programmatic-solving via permuted wire ids](#2026-06-12-shared-protocol-anti-programmatic-solving-via-permuted-wire-ids-and-anchor-offsets) -> still pending: `MPP_PUZZLE_ID` is `synthetic-1m` today, so the real photo's R2 re-upload under wire-id paths has not happened yet.
- [Per-cell compositing on a debounced dirty-cell queue](#2026-07-24-backend-realtime-per-cell-compositing-runs-on-a-debounced-dirty-cell-queue) -> the drain loop's one-at-a-time throughput is unmeasured against real bake volume; also still pending the `MPP_R2_*` Coolify secrets before it does anything in prod.
- [CompositeTileLayer is the only rendering path for locked content](#2026-07-26-frontend-canvas-compositetilelayer-is-the-only-rendering-path-for-locked-content) -> `COMPOSITE_VRAM_BUDGET_MB` is an unmeasured default against a real multi-level pyramid's actual per-tile byte cost.
- [seed-lock-scenario locks pieces through the real grab/drop path](#2026-07-27-qa-and-load-seed-lock-scenario-locks-pieces-through-the-real-grabdrop-path) -> verified at 10 000-piece scale (clean full-pyramid composite, no missing cells); still not run at the real ~995 000-piece scale, and full client-side rendering not yet visually confirmed end to end.

---

## Log

### 2026-05-12, shared-protocol, absolute coords on drag

Choice: `CDrag`/`SDrag` carry absolute `worldX, worldY`, not deltas.
Why: robust to packet loss and reordering, no delta integration on the client.
Revisit when: drag bandwidth shows up in profiling, or per-frame rotation is added.

### 2026-05-12, shared-protocol, drop implies release

Choice: no explicit `release` message; `CDrop` finalizes the position and releases the lock atomically.
Why: one round trip, matches mouse-up semantics.
Revisit when: never expected; a disconnect mid-drag already releases every held group immediately (see per-group dispatch queues below), so no case has needed "user let go" to diverge from "client disconnected".

### 2026-05-12, shared-protocol, PROTOCOL_VERSION

Choice: `PROTOCOL_VERSION` (currently 9) is asserted at handshake. The client sends it in `hello`; the server closes with `protocol_mismatch` on any skew instead of letting a stale client hit malformed-message errors.
Why: turns a client/server skew into one clear handshake error instead of scattered downstream failures.
Revisit when: any further breaking wire change; bump the version again.

### 2026-05-20, shared-protocol, presence messages

Choice: presence is 4 message types. Client to server: `viewport` (visible rect, for broadcast scoping) and `cursor` (pointer). Server to client: `join`, `leave`, and a `cursor` relayed to viewport-neighbor peers. There is no server `viewport` relay.
Why: viewport and cursor change on independent triggers (pan/zoom vs pointermove) at different cadences, so a combined message would resend unchanged fields; viewport has no client-facing consumer yet, so relaying it would be speculative.
Revisit when: a minimap wants to draw peer viewports (add a server relay), or "pointer left canvas" needs to be distinguished from "peer idle".

### 2026-05-12, piece-generation, canonical sign convention

Choice: each shared edge derives `sign` once from a canonical subseed. The piece using it as `bottom`/`right` takes the canonical sign, the one using it as `top`/`left` takes the opposite; all other params are shared as-is.
Why: both neighbors traverse the edge in the same world direction, so only the sign needs to flip to express "bump out" vs "bump in".
Revisit when: never expected, unless the traversal convention changes.

### 2026-06-09, image-pipeline, pre-cut alpha masks baked server-side

Choice: the slicer bakes each piece's bezier silhouette into its AVIF alpha, and strokes the shared border style into the same tile (`borderBaked: true`), reading per-piece windows directly from the source via libvips random access. The manifest marks `premasked: true`; the frontend renders tiles as-is with no render-time mask or stroke, still deriving geometry from the seed for layout, the spatial index, the minimap, and the snap-flash overlay only.
Why: bezier params are frozen, so baking once removes a per-sprite stencil mask (which breaks Pixi batching) from the render hot path, the part that didn't scale to 1M; reading windowed tiles keeps slicer RAM independent of source image size.
Revisit when: the silhouette params or border style change (forces a full re-bake and re-upload of every tile), or rotation is enabled (baked alpha fixes each tile's tab orientation).

### 2026-05-12, image-pipeline, tile margin

Choice: tile margin defaults to `round(0.35 * pieceSize)`, just above the generator's max `depth` param (0.30).
Why: guarantees tabs fit inside the tile with a safety buffer.
Revisit when: edge param ranges widen, or rotation is enabled.

### 2026-05-12, image-pipeline, adaptive pieceSize

Choice: `--piece-size` is optional. When omitted, it is derived from the source image dimensions and the puzzle area is center-cropped.
Why: the pipeline should adapt to any dropped image; center-crop keeps the visually important middle.
Revisit when: a workflow needs the full image with no crop, a non-center anchor, or non-square pieces.

### 2026-05-12, backend-realtime, snap by origin equality

Choice: at drop, the server collects grid-neighbor groups within `snapTolerance`, skips any candidate currently held by another user, picks a target origin (a locked candidate if present), then merges only candidates also within tolerance of that target.
Why: canonical offsets are puzzle-global, so aligned clusters have equal origins; the target-filter pass is needed because two candidates can each be near the dropped group while being up to `2 * snapTolerance` apart from each other. A held candidate is skipped because its stored position is frozen at grab time, not its holder's live position.
Revisit when: rotation is enabled (origins alone won't suffice), or canonical offsets stop being puzzle-global.

### 2026-05-12, backend-realtime, docker all workspace deps

Choice: the server Docker image runs `npm ci --omit=dev` at the repo root (all workspaces), not scoped to `@mpp/server` + `@mpp/shared`.
Why: monorepo workspace-filtered `npm ci` is brittle; installing everything is one deterministic line and still excludes dev deps.
Revisit when: image size or cold-start time matters; switch to a server-only install or split lockfiles.

### 2026-05-12, shared-protocol, piece geometry and seed are server-side only

Choice: piece silhouettes and canonical offsets are never serialized; `generationSeed` is never sent to a client. The client renders pre-masked, pre-bordered tiles plus server-provided `(dx, dy)` member offsets, with no geometry and no seed.
Why: at 1M pieces geometry would dominate payload size; beyond size, a client that could recompute geometry could reconstruct the solution, the reason it closes together with [permuted wire ids](#2026-06-12-shared-protocol-anti-programmatic-solving-via-permuted-wire-ids-and-anchor-offsets).
Revisit when: the generator becomes non-deterministic across platforms; pin to fixed integer math rather than ship geometry. Image-based (CV) solving stays explicitly out of scope.

### 2026-05-12, frontend-canvas, no synchronized entrance cascade

Choice: there is no synchronized event-start cinematic on the canvas. `eventStartsAt` only drives the landing countdown and the `/play` entry gate; once a client is on `/play`, nothing distinguishes "just started" from "already running".
Why: a dedicated cascade animation was never built while the puzzle was small enough for the idea to matter, and was dropped rather than built after the fact for a launch moment that only happens once; the countdown and gate already carry the "something is about to happen" signal.

### 2026-05-29, backend-realtime, per-group dispatch queues

Choice: WS messages dispatch on per-group queues keyed by group id (`GroupQueue`). Disjoint-group tasks run concurrently; same-group tasks run in submission order. `dev_*` admin ops take a global barrier; `hello`/`viewport`/`cursor` run inline; disconnect release is O(held groups) via `Client.held`.
Why: one global serial queue blocked independent groups behind each other; per-group queues keep the ordering handlers depend on while letting disjoint work run in parallel. Keys are acquired synchronously at submission, so the dependency graph can't deadlock.

### 2026-05-18, frontend-shell, dev controls

Choice: `/play` exposes Place/Reset/Complete buttons wired to `dev_*` WS messages, visible under `VITE_DEV_BUTTONS` and accepted server-side only under `MPP_DEV_ENABLED=1`. Reset/Complete require a `confirm()` since they affect every connected tester.
Why: testers need to exercise the end-of-puzzle UI and reset a stuck board with no operator intervention; the env gate lets it be pulled in one redeploy.
Revisit when: confirmed still on as of 2026-07-09: `MPP_DEV_ENABLED=1` is baked in `packages/server/Dockerfile`, and `VITE_DEV_BUTTONS` is unset in `packages/frontend/.env.production` (defaults to shown). Both must flip before the real photo goes live with real community progress at stake.

### 2026-05-18, backend-realtime, WS hardening

Choice: 5 boundary limits: an Origin allowlist on upgrade, a `maxPayload` frame cap, a per-IP token bucket on inbound messages, a per-IP connection cap, and a `bufferedAmount` close for slow consumers. The rate bucket and connection count are keyed by `CF-Connecting-IP`, shared per IP via `IpRegistry`.
Why: without these, one client can CSRF-connect from any origin, flood messages, open unbounded sessions, or stall the writer's memory on a slow socket.
Revisit when: the origin is firewalled to Cloudflare ranges (the open ROADMAP backlog item); until then `CF-Connecting-IP` is spoofable direct-to-origin and these per-IP limits are bypassable.

### 2026-05-18, infra-deploy, alpha topology

Choice: single OVH VPS-3 (12GB) with Coolify on the same host. Node heap is capped at 5GB and Mongo's cache at 1GB so services don't contend. `ws.*` is Cloudflare-proxied with an Origin CA cert (Full-strict TLS); the server pings every 30s since Cloudflare drops an idle WS at ~100s.
Why: a public WS edge needs Cloudflare's DDoS layer, which a DNS-only record doesn't get; an Origin CA cert is set-and-forget versus fighting Let's Encrypt HTTP-01 behind the proxy.
Revisit when: the origin isn't yet firewalled to Cloudflare ranges (`CF-Connecting-IP` is spoofable direct-to-origin) - the one item still open in the ROADMAP backlog.

### 2026-06-06, backend-realtime, spatial broadcast index and cluster-AABB scoping

Choice: drag/drop/cursor broadcasts are scoped through a `Map<cellKey, Set<Client>>` spatial index over the shared world grid (plus a global-subscriber fallback for viewports over a cell cap), instead of a linear scan of every client. Scoping uses the dragged cluster's full world AABB (stored per group, updated at merge), not just its origin point.
Why: linear scan was O(connected clients) per event, the scaling bottleneck; full-AABB scoping fixes large clusters being missed when their origin sat off-screen but their body didn't.

### 2026-06-06, backend-realtime, group spatial index and pan resync

Choice: a second per-process index (`GroupIndex`, one cell per group by body top-left) answers "which groups sit in these cells", so a client panning into a region gets resynced via `region_state`, closing the gap where a non-merging drop (scoped, unpersisted) never reached a client that wasn't watching. A resync applies only when the client isn't already holding or awaiting that group, so it never rewinds a newer live update.
Why: the broadcast index reaches current viewers of a live drop but does nothing for a later arrival; this index serves that read path the way the broadcast index serves the write path.

### 2026-05-21, frontend-canvas, leaderboard scoring

Choice: each piece scores one point, credited to the user of the first `ClusterMerge` (by time) whose `droppedPieceIds` lists it. Standings are a `cluster_merges` aggregation, re-run after every anchoring snap.
Why: a piece moves only when its group is dragged, so crediting the first drag gives each piece exactly one point; `droppedPieceIds` (not `addedPieceIds`) is the side the user actually dragged.
Revisit when: the puzzle is now genuinely at 1M scale, not a future hypothetical; re-running the full aggregation on every snap is worth checking against live latency, and precomputing a per-user counter if it shows up.

### 2026-05-20, shared-protocol, lockedDelta stored on ClusterMerge

Choice: `ClusterMerge` persists `lockedDelta`, the pieces newly locked to the frame by that merge, even though other stats derive on demand.
Why: a frame anchor locks pieces without listing them in `addedPieceIds`, so the activity feed's "placed N pieces" count can't be reconstructed after the fact; it is a property of the event, not a precomputed counter.

### 2026-05-21, frontend-canvas, frustum culling and tiled zoom-out LOD

Choice: three techniques bound rendering to the visible window via one shared spatial index (`GroupGrid`): (1) per-frame frustum culling queries the index for the keep-ring around the viewport instead of scanning the board; (2) below `LOD_ENTER_ZOOM` (0.3) the play zone renders as baked render-texture tiles instead of live per-piece sprites, with hysteresis back above 0.35; tiles are LRU-capped by a VRAM budget with a screen-cover floor so a needed tile is never evicted.
Why: culling alone doesn't help fully zoomed out, where every piece is visible; the single play-zone texture it replaced lost sharpness as the board grew and cost O(board) to re-bake. Tiling makes per-piece density constant and bounds VRAM and bake cost to the visible window.
Revisit when: 1M runtime smoothness is verified (ROADMAP, closed). Standing limitation, not scheduled for a fix: the active LOD band is overview-only (no grab below `LOD_ENTER_ZOOM`); if far-zoom grabbing is ever wanted, keep resting clusters hit-testable while hidden rather than lowering the threshold.

### 2026-05-21, frontend-canvas, play-zone hard limits

Choice: the board is bounded by a play zone computed once server-side (AABB of the frame and every scattered piece, widened by 50%, grid-snapped) and sent in `welcome`; camera and held pieces are clamped to it client-side.
Why: a per-client computation would drift as pieces move inward while solving, giving late joiners a smaller zone than early ones; computing it once server-side from the seed keeps every client's bound identical.
Revisit when: never scheduled; still no server-side position validation, so a malicious client can send out-of-zone positions and nothing on the server rejects them. Accepted as a standing gap, not queued for a fix.

### 2026-05-23, image-pipeline, reference image as a Deep Zoom pyramid

Choice: the slicer writes the reference image as a Deep Zoom pyramid (`source.dzi` + WebP tiles), opened directly by OpenSeadragon.
Why: one format covers both the alpha-scale and the gigapixel source; OSD fetches only the tiles the viewport needs, so a full-res image is never downloaded whole.
Revisit when: another consumer needs one full-resolution image (e.g. a thumbnail generator); serve that separately rather than re-adding a full AVIF to the manifest.

### 2026-05-22, infra-deploy, single R2 bucket for tiles and pieces

Choice: Deep Zoom tiles and per-piece AVIF textures share one R2 bucket (`mpp-assets`), separated by key prefix, fronted by a Cloudflare custom domain (not `r2.dev`).
Why: both asset sets share the same pipeline run, immutable lifecycle, and caching needs; a custom domain gives CDN cache control and no rate limit.
Revisit when: an asset set needs an independent cache TTL or access policy.

### 2026-05-23, image-pipeline, piece tiles bucketed by hundreds

Choice: piece tiles live at `pieces/<bucket>/<id>.avif`, `id` the seed-permuted wire id, `bucket = floor(id / 100)`. The manifest carries the resolved path; nothing reconstructs it from `id`.
Why: a flat million-entry directory is unwieldy for `ls`, R2 listings, and inspection; bucketing by 100 keeps both directory count and per-directory size comfortable at 1M scale.
Revisit when: never expected at this granularity; widen the padding if the puzzle grows past 1M.

### 2026-05-23, backend-realtime, manifest fetched from R2 at boot

Choice: the server fetches `manifest.json` from R2 once at boot and aborts on any network error, non-2xx, or id mismatch; no local fallback, no cache, no retry.
Why: R2, behind the CDN, is the single source of truth shared by server, frontend, and Pages build; fail-fast turns a bad manifest into a visible restart loop instead of a half-initialized process serving a stale puzzle.
Revisit when: a boot-time R2 read becomes a deploy hazard during an extended Cloudflare/R2 incident; keep a last-known-good manifest on a small persistent volume as a fallback then.

### 2026-05-28, qa-and-load, harness PASS criterion bounded to saturation signals

Choice: the load harness gates PASS on zero 1013 (backpressure) closes, zero `ws` errors, and under 5% server error frames. Latency (p50/p95/p99) is reported but not gated.
Why: the Phase 1 exit bar was "without server saturation"; an early 20-bot baseline showed multi-second latency bounded by the (since-fixed) serial dispatch and unthrottled drag broadcast, not by a load-induced fault, so an absolute latency gate would have conflated "does it stay up" with "is it snappy".

### 2026-06-07, qa-and-load, harness seeds sessions by direct Mongo write

Choice: the load harness seeds one disposable user and database session per bot directly in Mongo (Auth.js adapter shape, tagged `loadTest: true`), sending the matching session cookie on WS upgrade, instead of a dev-only session-minting endpoint.
Why: sign-in is Google OAuth only with no programmatic path, and a dev-gated mint endpoint would be live in prod (`MPP_DEV_ENABLED=1`), a standing way to mint sessions; direct seeding adds no new server attack surface.
Revisit when: the Auth.js adapter or session strategy changes (the seeded shape would drift), or a prod path with no Mongo tunnel is wanted.

### 2026-05-28, backend-realtime, scatter as a detached center-dense rounded-square band

Choice: the initial scatter samples each piece body in a rounded-square band detached from the frame (a gap, then a dense-mid-band halo), then derives the group origin from it.
Why: randomizing the origin alone left the solved image visible in place plus jitter; randomizing the body decouples the shuffled layout from the solved one, and the gap plus triangular radius make the cloud read as a detached, tipped-out pile rather than a band hugging the frame.
Revisit when: the gap or halo size, or the corner roundness, needs retuning by eye.

### 2026-06-01, auth-and-accounts, Auth.js via @auth/express with database sessions

Choice: Auth.js is mounted on the server's Express app, Google-only, with database sessions via `@auth/mongodb-adapter` sharing the one `MongoClient`. The cookie is `SameSite=Lax`, `httpOnly`, `Secure`-derived, domain-scoped for the `app.*`/`ws.*` split.
Why: `@auth/express` is the supported host, letting `ws` and auth share one process; database sessions give server-side revocation and a profile to hang the pseudo on.
Revisit when: a second writer instance is introduced, or sign-in needs more than Google.

### 2026-06-01, auth-and-accounts, WS upgrade requires a valid session

Choice: `verifyClient` resolves the session cookie via the adapter and rejects an upgrade with no valid session (401 at handshake); the connection carries the real `user._id`, replacing the old per-connection random id.
Why: contribution must be gated server-side, not just in the UI; reusing the SPA's own cookie needs no new protocol field.

### 2026-06-01, infra-deploy, auth secrets in Coolify env, not in the image

Choice: `AUTH_SECRET`/`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are set only in the Coolify service environment, never in the Dockerfile or repo; non-secret server config is baked as Dockerfile `ENV`.
Why: baking OAuth credentials into an image built and cached in CI leaks them; they belong in the orchestrator's secret store. A deployed compose file re-declaring the non-secret keys with localhost defaults previously shadowed the baked prod values (broken CORS, host-only cookie) until moved out.
Revisit when: a real secrets manager is introduced (all secrets move there together), or Coolify is reconfigured to merge the local override file (would reintroduce the shadowing).

### 2026-06-01, auth-and-accounts, login anti-abuse is internal per-IP rate limiting

Choice: two Redis-backed per-IP fixed-window counters (a generous window on `/auth` and `/profile`, a stricter one on the OAuth callback), fail-open on a Redis error. No Cloudflare Turnstile.
Why: with Google-only OAuth, each fake account already costs the attacker a real Google account; Turnstile's usual value (stopping password brute force) doesn't apply with no password form, so per-IP request-rate limiting is the remaining relevant surface.
Revisit when: IP rotation evades the per-IP budget under real public load; escalate to a Cloudflare edge Rate Limiting Rule on `/auth/*` then.

### 2026-06-03, frontend-canvas, viewport-driven texture streaming

Choice: per-piece textures and Pixi nodes are built on demand inside a ring around the viewport and freed on a wider hysteresis ring, instead of all at `build()`. `build()` now only creates lightweight containers and the spatial index from geometry, no textures fetched.
Why: fetching and building every piece at `build()` was O(board) in fetches, VRAM, and main-thread work; bounding to the visible window (~15-25k pieces at 1M) is the scaling move.
Revisit when: a background tab parks the ticker, so the initial fill pauses until focused. Resident VRAM at a deep zoom-out is addressed by [hot-tile residency](#2026-06-05-frontend-canvas-hot-tile-residency-frees-covered-cold-clusters).

### 2026-06-04, frontend-canvas, chunked board build with lazy geometry

Choice: `build()` runs in time-budgeted yielding passes (8ms bursts) instead of one synchronous block, and full per-piece edge geometry is generated only on hydration, cached and evicted on dehydrate.
Why: the eager path froze the main thread for seconds at 1M (geometry generation plus the group/index loop, all synchronous); only the visible window needs full geometry, so generating it for all 1M up front was wasted work.

### 2026-06-04, frontend-canvas, z-order layers replace world sortableChildren

Choice: stacking depth is now which fixed layer container (locked/unlocked/LOD-tiles/held) a group's container lives in, not a `zIndex` under `sortableChildren`.
Why: `sortableChildren` re-sorted the whole board on every grab/drop/anchor depth change; fixed layers make a depth change an O(1) reparent instead.
Revisit when: a grab at 1M hitches on the reparent's array splice out of a million-child layer; back the layers with a structure that removes in O(1) if so.

### 2026-06-05, frontend-canvas, hot-tile residency frees covered cold clusters

Choice: while the zoom-out LOD covers the board, a non-held cluster whose tiles are all baked and untouched for `LOD_HOT_TTL_MS` (9s) becomes evictable; a throttled per-frame sweep frees the coldest ones (LRU) once resident piece-node count exceeds `RESIDENT_PIECE_BUDGET` (24000).
Why: viewport-driven streaming kept the whole deep-zoom-out window resident behind the baked tiles, an unbounded VRAM cost; eager freeing on bake was tried and rejected (thrashes on any shallow zoom in/out). Budgeted LRU eviction only kicks in above budget, so the common case never evicts.
Revisit when: `RESIDENT_PIECE_BUDGET` is a node-count proxy for VRAM, derive from tile size if texture size varies; tune the hot TTL against observed play patterns.

### 2026-06-06, backend-realtime, viewport-scoped initial state on join

Choice: `welcome` carries no board (protocol v3); the client starts empty and streams groups in per viewport via `region_state` off the group index, bounded by viewport, not piece count. A default (unzoomed) viewport is a global subscriber and streams nothing; the minimap covers the overview until the user zooms in.
Why: a full `state` array on connect was O(board), ~25 MB at 1M, the last unscaled join path.
Revisit when: per-cell payload size bites (stream only changed groups); or a zoomed-out backdrop image is wanted (ROADMAP backlog).

### 2026-06-06, backend-realtime, server-computed minimap grid

Choice: the minimap renders from a compact server-computed density grid (`MinimapGridTracker`, ~96 cells/axis), maintained incrementally on every drop/merge (moving only that group's own cells) rather than rescanned. A full recompute seeds it at boot/reset/force-complete, plus a slow (24h) defense-in-depth resync.
Why: the client can no longer scan the whole board for a minimap under the viewport-scoped join; the grid used to be rebuilt from two full-board Redis pipelines every 5-minute keyframe tick, which starved concurrent gameplay for the whole live event, the one recurring O(board) cost this project otherwise eliminated everywhere else.
Revisit when: the 5-min broadcast cadence is too stale, the ~96-cell resolution reads too coarse at 1M, or the 24h resync interval (an unmeasured default) needs tuning against real traffic.

### 2026-06-08, frontend-shell, interested counter dedup by hashed-IP set

Choice: the landing "I'm interested" count is a Redis SET keyed per puzzle, one HMAC-SHA256-hashed visitor IP per member; the count is `SCARD`.
Why: a SET makes dedup inherent, with no separate counter to drift; hashing keeps a Redis dump from exposing raw IPs, since (unlike the short-lived rate-limit keys) this set is permanent.
Revisit when: set cardinality grows large enough to matter.

### 2026-06-08, infra-deploy, scheduled backups to a private R2 bucket

Choice: a `backup` sidecar dumps Mongo (`mongodump --archive`) and Redis (RDB pulled over the wire) every 6h to a private, separate R2 bucket (`mpp-backups`), keeping the newest 3 of each. Disabled locally by default.
Why: the single VPS has no off-host copy of live state otherwise; a private bucket is required since Mongo dumps carry user PII the public asset bucket can't host. Keep-3/6h is deliberately shallow: dumps are small and the dominant failure is total host or volume loss, which any recent backup covers.
Revisit when: point-in-time recovery is needed; today's snapshots are coarse recovery points, not continuous.

### 2026-06-09, piece-generation, edge uniqueness validated per-seed

Choice: "every shared edge unique" is validated per base seed by counting distinct 32-bit edge subseeds across the ~2M shared edges (`npm run validate:generation`), not guaranteed by entropy.
Why: a naive birthday estimate predicts collisions, but the subseed's multiplicative mixing is empirically a near-permutation on this grid lattice (0 collisions observed); counting is exact and cheap, and widening the seed would re-roll all geometry for a problem that doesn't occur.
Revisit when: the production seed for the real photo has not been validated yet (prod still serves `synthetic-1m`); run validation before that slice, and widen the edge seed to 53 bits if the grid ever grows past 1000x1000.

### 2026-06-11, backend-realtime, per-tile piece cap on non-merging drops

Choice: a non-merging drop is rejected (bounced back with a `rollback`) when its destination world-grid cell already holds more than `MPP_TILE_PIECE_CAP_MULTIPLIER` (8) times the cell's solved density. Merges and frame anchors are exempt.
Why: the zoom-out LOD bakes a cell's live pieces into one texture; an unbounded pile on one tile would make that bake O(board).
Revisit when: 8x proves too loose or strict against live usage; note exempt merges can still push a cell over the cap and block an in-cell rearrange.

### 2026-06-11, frontend-shell, /play entry gate mirrors the scheduled start

Choice: a router guard redirects `/play` to landing while a real `eventStartsAt` is set and still in the future; an unset start or a failed landing fetch leaves `/play` open (fail-open).
Why: the gate should arm only when an operator schedules the event, so local dev and today's unscheduled prod stay reachable; fail-open avoids stranding a live visitor over a transient fetch blip, since this is a UX seal, not a security boundary (contribution is still gated server-side by the WS session).
Revisit when: a hard pre-launch lock is needed; move the decision server-side then.

### 2026-06-12, shared-protocol, anti-programmatic-solving via permuted wire ids and anchor offsets

Choice: ids are seed-permuted (`wireId = P(gridId)`, deterministic Fisher-Yates, built once at boot). A group's transmitted position is its anchor piece's world position; member pieces carry a grid-unit `(dx, dy)` offset from it, so no transmitted position exposes a solved-space coordinate. `generationSeed` lives server-only, as a Coolify secret.
Why: `id % gridCols` gave any script every piece's solved cell, and a public seed let it regenerate silhouettes to match tabs; either leak alone is enough to script-solve the puzzle, so both had to close together.
Revisit when: `MPP_PUZZLE_ID` is still `synthetic-1m` in the Dockerfile; the real photo's R2 tile set has not yet been sliced and uploaded under wire-id paths with the matching `MPP_GENERATION_SEED`. Image-based (CV) solving stays explicitly out of scope.

### 2026-06-12, frontend-canvas, sticky carry mode (double-click to stick a cluster to the cursor)

Choice: a double-click sticks a cluster to the cursor with no button held; double-click again drops it, Escape returns it to pickup. It reuses the existing grab/drag/drop wire path; a 30s idle timeout (reset on real pointer moves) auto-drops it so a lock can't be parked indefinitely.
Why: press-and-hold drag is tiring for long hauls and fights panning; the browser's own drag-vs-dblclick disambiguation avoids a hand-rolled tap timer, and reusing grab/drop keeps the server oblivious.
Revisit when: never expected at this project's scale; the 30s lock-hold and the mouse-only trigger (no touch support) are accepted standing limits, not tuning targets.

### 2026-06-12, complementary, activity feed event types (snap vs place, piece vs cluster)

Choice: the feed shows "place" (an anchoring merge, sized by `droppedSize`) and "snap" (a non-anchoring merge, sized by `mergedSize`) events; non-merging drops are never shown.
Why: snaps are already globally broadcast, so this costs two extra ints, not new traffic; drops are viewport-scoped and would need a new scalable signal to surface globally, not worth it for what would be mostly noise.
Revisit when: the snap over-report (e.g. "connected a 30-piece cluster" for adding one piece) feels unfair; switch to dragged-group size then.

### 2026-06-19, qa-and-load, soak-test state-corruption validator and per-bot IP spoofing

Choice: (1) `validate-state` reads Redis and Mongo at rest and asserts board invariants, the strongest being that replaying the `cluster_merges` log reconstructs the exact Redis partition. (2) The harness can send a distinct spoofed `CF-Connecting-IP` per bot to bypass the per-IP connection cap when load-testing straight against the origin.
Why: the harness verdict only covered transport saturation; state corruption needed a real invariant check, and log-replay equality is the same property the data model promises for the timelapse. IP spoofing rides the known unfirewalled-origin gap, the cheapest way past the cap for a load test we control.
Revisit when: the origin gets firewalled to Cloudflare ranges (the open ROADMAP backlog item): the spoof must move inside the edge, or raise the cap env instead.

### 2026-06-26, infra-deploy, admin ops page

Choice: a password-gated `GET /admin` (HTTP Basic, mounted only when `MPP_ADMIN_PASSWORD` is set) does three ops: clear everything, set the event start (applies live), and switch the puzzle (persists an override and restarts the process).
Why: puzzle id and seed are consumed at boot to build nearly all server state, so re-deriving them in-process would mean rewiring most of `main()`; persist-and-restart reuses the existing boot path instead of a fragile in-process re-init.
Revisit when: more than a couple of puzzles is wanted (move the list out of an env JSON); a hot switch with no restart is needed (pay the in-process re-init then).

### 2026-06-27, frontend-canvas, strict grab hit-test by sampling tile alpha

Choice: a grab only starts when the pointer is over opaque pixels, tested by sampling one texel of the tile's alpha via a reused 1x1 scratch canvas, rejecting Pixi's rectangular hit bounds (transparent tab margins, corners, gaps). A miss lets the press bubble to a pan instead.
Why: the alpha cut is the only silhouette the geometry-free client has, and reading it leaks nothing a bot couldn't already get from the rendered canvas; a per-click 1px read costs nothing, so no precomputed per-piece mask is needed.
Revisit when: rotation is enabled (the axis-aligned tile mapping breaks); touch/pen wants a fatter tolerance (sample a neighborhood, not one texel).

### 2026-06-27, frontend-canvas, minimap masks the server density grid under known regions

Choice: the minimap skips painting the server density grid in cells the client already has live group knowledge of, leaving only the live dot overlay there.
Why: the server grid only refreshes on a snapshot tick, so it reads stale under a region the player is actively solving; masking keeps known regions live and the grid useful only where still needed.
Revisit when: masking granularity bites, since a coarse grid cell hides density for still-unknown pieces sharing it with a known group; subtract known counts from the grid instead of masking whole cells if that matters.

### 2026-06-30, auth-and-accounts, guest players are real users with a claim token

Choice: `POST /guest` mints a real `User` (`guest: true`) plus a database session through the same Auth.js adapter path a Google sign-in uses. A one-time claim token (only its hash persisted) lets a later Google sign-in absorb the guest via `POST /guest/claim`: an atomic anti-double-claim lock, `cluster_merges.userId` reattributed by `updateMany`, pseudo/country carried onto the target.
Why: open access wants immediate play with no OAuth round trip, but one identity model (a guest is a real `User`) keeps the WS gate, profile routes, and leaderboard unchanged; hashing the token mirrors the posture already used for session tokens.
Revisit when: the claim `updateMany` is O(merges) for the guest, fine per guest but revisit if one guest amasses a large board share. No inactivity sweep exists for throwaway guests; accepted, none planned.

### 2026-06-30, frontend-shell, guest claim fires on boot, gated by claimSettled

Choice: the guest claim token is stored client-side at mint and redeemed on app boot, not from a button, whenever it coexists with a fresh Google session. `/play` onboarding is held behind a `claimSettled` flag until the claim resolves, so a synced account never flashes a forced-pseudo modal.
Why: sign-in navigates away to Google and back, so there is no in-page callback to fire the claim from; keying it on "token plus Google session" makes it survive the redirect and self-correct a leftover token.
Revisit when: sign-in gains an in-page callback; move the trigger there instead of boot.

### 2026-07-01, backend-realtime, admission queue

Choice: a global cap on concurrent WS connections (`MPP_MAX_ACTIVE_CONNECTIONS`, default 0 = disabled) with an in-process FIFO wait list (`AdmissionController`). A client requests a ticket before connecting: under the cap it gets a one-time grant token immediately, over the cap it polls a queue position. A grant reserves a slot so the cap is never oversubscribed between grant and upgrade; TTLs reclaim abandoned grants and tickets.
Why: once everyone shares the one real-time path, the box needs a safety valve that sheds load into an orderly wait instead of accepting connections until it falls over.
Revisit when: fairness is per-ticket not per-user, so one user with many tabs holds many tickets; accepted at launch, revisit if queue-jumping by multi-tab becomes a real complaint.

### 2026-07-02, auth-and-accounts, 24h cooldown on pseudo/country changes

Choice: pseudo and country changes are throttled to once per 24h once already set; the very first assignment (guest mint or forced onboarding) is free. The check-then-write is two steps, not atomic.
Why: distinguishing "initial choice" from "change" by whether the field was already non-null keeps onboarding free while throttling repeat edits, with no separate onboarding flag needed.
Revisit when: the non-atomic check needs to be airtight (a single `findOneAndUpdate`); pseudo and country need different cooldowns.

### 2026-07-04, qa-and-load, load-test bot viewport memory bounded per window

Choice: `World.resetForNewViewport` clears the bot's local group/piece mirror on every viewport tick, keeping only a currently-held group, instead of accumulating every group ever seen.
Why: bots jump to a random viewport every second rather than panning; at 1M scale a dense random jump could pull in tens of thousands of groups per bot per second with nothing ever freed, OOM-ing the harness (~2GB heap, ~100s into a 50-bot run) at a scale smaller boards never hit.
Revisit when: the bot's movement model changes from random jump to smooth pan; move to ring-based eviction like the real frontend's instead of a full reset per tick.

### 2026-07-05, backend-realtime, grab reservation race and stale-hold sweep

Choice: (1) a grab reserves its group id in `client.held` synchronously at dispatch, before the Redis round trip, closing a window where a disconnect mid-grab could leave a group held by a gone connection with no release path. (2) A periodic sweep (30s) force-releases any group held longer than `MPP_STALE_HOLD_MS` (180000), covering the remaining case: a server crash or redeploy orphans holds since Redis survives restart but in-process `Client` state doesn't.
Why: an orphaned hold makes a piece permanently unsolvable (it can't be re-grabbed or merged into); the sweep gives that invariant a live enforcer instead of only a post-hoc validator.
Revisit when: `MPP_STALE_HOLD_MS` is an unmeasured heuristic ceiling; tune from observed live hold durations once the real event is running.

### 2026-07-10, auth-and-accounts, international opt-out reuses the UN flag code

Choice: the nationality picker offers a pinned "International" option alongside real countries, backed by `un`, the only non-ISO-3166-1 code `normalizeCountry` accepts. `un` is already a circle-flags asset (a globe glyph), so it needs no new SVG. The shared `COUNTRIES` list itself stays pure ISO codes; the picker renders "International" as its own labeled entry rather than looping it into the alphabetical list.
Why: reusing an existing flag asset skips a new SVG and upload step; accepting the code inside `normalizeCountry` means the server route, leaderboard bucketing, and topbar avatar all handle it like any other country with no special-casing.
Revisit when: never expected; a second opt-out-style code would need generalizing the single hardcoded check into a small allowlist.

### 2026-07-06, backend-realtime, paced region_state batching

Choice: a viewport's `region_state` resync for newly entered cells is split into several paced messages, batched by non-overlapping world-grid columns (`MPP_REGION_STREAM_BATCH_CELLS` cells each), sent with a poll-and-wait between batches until `ws.bufferedAmount` clears half the hard limit. A new `viewport` on the same connection supersedes an in-flight stream.
Why: a big viewport jump (minimap jump, fast zoom) could enter up to 256 cells at once, sending close enough to the 4MB buffered-amount limit to trip the slow-consumer close; column-range batches keep `coverage` provably correct per batch.
Revisit when: `MPP_REGION_STREAM_BATCH_CELLS`/`_POLL_INTERVAL_MS` held clean through a 2026-07-06 re-soak (50 bots) but real public traffic could still exceed that; tighten if 1013 closes reappear. Raising the buffered-amount limit itself is a separate, deferred follow-up.

### 2026-07-11, frontend-canvas, minimap memory readout is internal accounting

Choice: the minimap detail modal's memory line sums the client's own resident-texture accounting (resident piece-node count times `manifest.tileSize^2 * 4` bytes, plus the LOD tile layer's resident bytes) against their existing soft budgets (`RESIDENT_PIECE_BUDGET`, `LOD_VRAM_BUDGET_MB`), not `performance.memory` or any OS/GPU-level VRAM read.
Why: true GPU VRAM isn't readable from JS; `performance.memory` is Chrome-only and measures JS heap, not GPU texture memory, so it would mislabel a diagnostic meant to explain the app's own streaming behavior. The app's internal counters are exact for what they track.
Revisit when: never expected; if a budget ever becomes dynamic (e.g. the LOD screen-cover floor pushing resident tiles past the nominal soft budget) rather than a fixed constant, decide whether the readout should track the nominal or the effective ceiling.

### 2026-07-11, frontend-canvas, minimap loose/locked layers scale independently

Choice: the density-grid overview paints the loose and locked layers each against their own per-layer max cell count, not one shared max.
Why: loose pieces vastly outnumber locked ones for most of the puzzle's life (nearly all 1M start loose), so a shared max diluted locked cells to near-background alpha right when "which pieces are placed" is the signal a player most wants to read; verified live on the dev board (35 locked of 1M), a locked cell rendered at alpha 0.2 (indistinguishable from the loose tint) under the shared max versus 0.75 under the independent one.
Revisit when: never expected; a lone locked cell now reads at near-full alpha regardless of how sparse it is relative to the rest of the board, the intended trade-off (progress must stay legible over calibrated density), mirroring how the loose layer already scales against its own max.

### 2026-07-22, frontend-canvas, minimap detail modal shows only genuinely in-flight cells as loading

Choice: `classifyTile` marks a known, not-ready cell "loading" only when it is actively being worked on right now: a member group's `hydrating` flag or presence in `hydrateQueued` while zoomed in, or membership in the LOD layer's current `neededTiles` bake set while zoomed out. Any other known, not-ready cell reads "not-loaded", same bucket as a cell never visited. The modal also draws the puzzle frame and the camera frustum over the tile grid, reusing `MinimapSnapshot.frame`/`viewport` the same way MiniMap.vue does.
Why: `knownCells` never shrinks and budget eviction (`evictResidentsOverBudget`) or LOD `cull()` routinely dehydrate or drop tiles once the viewport moves on, so a cell that was visited and released reads identically to one still being fetched under the old known-and-not-ready rule. A player reported the modal's orange trail was mostly their own pan history, not pending network work, and that the tile grid had no spatial reference to place it against.
Revisit when: never expected; both signals are the actual fetch/bake bookkeeping, not heuristics.

### 2026-07-23, frontend-canvas, texture hydration queue reordered by viewport proximity

Choice: `pumpHydration` reorders the pending `hydrateQueue` by squared distance to the current viewport center (nearest popped first) instead of draining strict FIFO, but only when the queue holds more than the in-flight cap can start this frame; a queue that fits within capacity starts regardless of order, so the reorder pass is skipped in the common case.
Why: entries were queued in discovery order during `reconcileGroups`, which tracks the path a pan swept, not where it stops. A fast or long pan built a backlog of groups from along that path ahead of the groups under the just-settled viewport, so a player landing somewhere new waited on stale, no-longer-relevant fetches to drain first. The reorder is a full array sort each time it runs (not a proper priority heap); acceptable because it is gated on an actual backlog and the queue is bounded by groups near the viewport, not board size.
Revisit when: a soak shows the sort itself costing frame time, i.e. backlogs routinely far larger than what the hydrate ring's margin should ever hold; a binary heap would drop the per-pump cost from O(n log n) to O(log n) per pop.

### 2026-07-23, backend-realtime, locked pieces stop being a group

Choice: on anchor, a cluster's group is deleted rather than merged into a growing locked group; `locked` moves to a piece-level flag (`piece:<id>.locked`), and a locked piece's position is never stored, since it is implicitly its own canonical solved position at internal origin (0,0). `detectSnap` treats any locked grid-neighbor as an automatic match against that implicit target, still gated by the drop's own tolerance to it (a locked neighbor never substitutes for that check). `MPP_CLUSTER_PIECE_CAP` (default 20000) caps a loose-loose merge only; an anchoring merge is exempt, since it dissolves rather than grows a group.
Why: the old model kept folding every newly-anchored cluster into one ever-growing locked group; near completion that produced a single group of hundreds of thousands of members, and the client's hydration path fetched a whole group's members in one unbounded batch on a resync, an unbounded-load crash risk.

### 2026-07-23, backend-realtime, locked-piece delivery via a bitset, not a reverse index

Choice: `LockedPieceIndex` is a flat `Uint8Array` of one byte per piece (is-it-locked), with a cell's candidate piece ids recomputed on read from the grid geometry (`candidateGridIdsForCell`), not a stored `cell -> pieceIds` map.
Why: unlike a group's arbitrary live drop position (why `GroupIndex` needs a stored reverse map), a locked piece's cell is a pure function of its own grid id, fixed at generation and never changing once locked; `minimap.ts`'s density grid already treats a locked piece's cell the same way (`cellIndexForPiece(p.id, 0, 0, ...)`, computed, never looked up). A `Map<cellKey, Set<pieceId>>` at up to ~1M entries costs far more memory for no lookup-speed win at this scale.
Revisit when: never expected; the geometry this relies on (grid id -> canonical (col, row)) is fixed at generation.

### 2026-07-23, frontend-canvas, locked pieces render flat, decoupled from GroupNode

Choice: a locked piece is a standalone `PieceNode` in a flat `lockedPieces` map, with its own residency/hydrate-queue bookkeeping (`lockedResident`, `lockedHydrateQueue`) parallel to but never merged with the group-keyed ones (piece ids and group ids share one numeric space). It shares the group pool's `RESIDENT_PIECE_BUDGET` and LRU clock, evicted together, coldest-first, across both populations. An anchoring snap salvages an already-hydrated member straight out of its dying `GroupNode` (reparented, no re-fetch) rather than always fetching fresh.
Why: the ROADMAP's exit criterion is one shared memory budget, and a piece the player just dragged already has its texture loaded, so refetching it the instant it locks would be wasted network and a visible flicker. The per-piece hydrate queue is a small, separate duplication of the group one (no inner batch fetch, no `hydrateAttempts` retry-then-accept) rather than a shared mechanism: a locked piece has no membership, merge, or hold/drag, so forcing it through the group path would add branches to every one of those for a case that never applies to it.
Revisit when: never expected; if Stage 3's server-composited tiles end up replacing per-piece locked rendering entirely, this whole mechanism is removed rather than revisited.

### 2026-07-24, backend-realtime, per-cell compositing runs on a debounced dirty-cell queue

Choice: `applyMerge`'s anchor path only flags a cell's key dirty (`CellCompositor.markDirty`); a single background loop drains dirty cells one at a time, composites, and uploads, so a burst of lock events touching the same cell (a busy area filling in, or the dev force-complete shortcut) collapses into one rebake per cell instead of one per event. `forceComplete` has no per-piece incremental hook (it anchors directly via `anchorAllGroups`), so it dirties every cell in the grid at once rather than computing which ones actually changed; a rare dev-only bulk op, so redundantly recompositing an already-finished cell is an accepted one-off cost. A failed bake (fetch or upload error) is logged and dropped, not retried: the next lock event touching that cell re-attempts the whole bake from scratch, so it self-heals as long as the cell is not yet at 100% locked; a failure on a cell's last-ever lock leaves it one version stale until a future force-complete or reset, accepted the same way other rendering-only gaps in this codebase are.
Why: synchronous compositing inline in the lock-handling path would redo the same cell's bake repeatedly under exactly the traffic patterns (a filling-in hotspot, force-complete, the 995k-lock seed scenario) this project has already hit and fixed elsewhere (per-group dispatch queues, incremental minimap grid, paced region_state); a debounced queue keeps the same protection with no new process or IPC.
Revisit when: the drain loop's one-at-a-time throughput is unmeasured against real bake volume; widen to bounded concurrency if a soak shows cells backing up behind the queue.

### 2026-07-24, backend-realtime, cell composite geometry mirrors individual piece-tile bleed

Choice: a cell's composite canvas is `WORLD_TILE_SIZE + 2*margin` square (not a bare `WORLD_TILE_SIZE`), and its input piece set is not just the pieces the cell strictly owns but every piece within one column/row of that ownership range (`haloGridIdsForCell`), cropped to the canvas bounds before compositing (sharp's `composite()` throws rather than clipping an oversized or offscreen input). `cellKeyForGridId`/`allCellKeysForGrid` still use the plain (non-halo) cell definition for dirty-marking and enumeration.
Why: an individual piece's own tile already bleeds `margin` px past its canonical cell (so its tab can bulge into a neighbor), and margin is always < pieceSize (see tile margin), so a piece up to one column/row outside a cell's strict ownership can still have its tab reach that cell's canvas. Widening the canvas and the input set the same amount reproduces exactly the overlap individual piece tiles already have with each other; omitting it would visibly clip a tab at every cell boundary.
Revisit when: never expected; the margin-vs-pieceSize relationship this relies on is fixed at generation (see tile margin).

### 2026-07-24, backend-realtime, cell composites are version-suffixed immutable R2 objects, first live server write to R2

Choice: each rebake uploads to `<puzzleId>/cells/<cellKey>/<version>.avif` in the existing public `mpp-assets` bucket (a new key per version, never overwritten in place); `SRegionState.cellComposites` and the `cell_composite` broadcast carry `{cellKey, version}`, and the frontend derives the fetch URL from those two numbers, needing no manifest indirection (a cell position is not a solved-adjacency secret). Once a rebake's new version is fully live (index, Redis, broadcast), the version it superseded is deleted, so storage stays bounded by cell count instead of growing with every lock event over the puzzle's whole lifetime. Reads (each locked piece's own tile, to composite from) go over the same plain public HTTPS the frontend already uses; only the upload and the delete need credentials, `MPP_R2_ENDPOINT`/`MPP_R2_ACCESS_KEY_ID`/`MPP_R2_SECRET_ACCESS_KEY` (new `@aws-sdk/client-s3` dependency, R2's S3-compatible API), set in the Coolify env. All three unset (local dev's default) leaves `ctx.cellCompositor` unconstructed and compositing fully inert rather than failing the boot. A board reset (`PuzzleLifecycle.resetCurrent`) additionally bulk-deletes the whole `<puzzleId>/cells/` prefix (`CellCompositor.clearAll`, `R2Client.removeByPrefix`, paginated `ListObjectsV2` + `DeleteObjects`) rather than the last-known version per cell, since the reset empties the version index that a per-key delete would need to target, and a per-key delete would still miss any object a still-earlier reset already orphaned before this existed.
Why: an immutable-while-live, version-suffixed key matches the caching model every other R2 asset here already has (upload once, cache forever), needing no new Cloudflare cache rule or invalidation; every other R2 interaction before this was either a boot-time manifest read or the offline `rclone`-based pipeline upload, never a write from the live process. Deleting only the immediate predecessor, and only after the new version is confirmed live everywhere a reader could find it, keeps that guarantee for every version a client could actually be pointed at, while still bounding total storage. The reset's own cleanup has to go by prefix rather than by key for the same reason: a reset's whole point is discarding the version bookkeeping, so nothing is left to compute a specific key from.
Revisit when: never expected. The reset's bulk delete is best-effort (logged and dropped on failure, same as the per-rebake predecessor delete) and does not block the reset itself.

### 2026-07-26, backend-realtime, composite pyramid stops at level 3, cascaded bottom-up by child completion

Choice: the composite pyramid (see ROADMAP Phase 5 Stage 4) stops at level 3 (1296+324+81+25 = 1726 cells), not a wider draft once considered that ran to level 6: level 3 already covers only 1/25 of the board, so no level is small enough to be a genuinely global handful of tiles, and every level streams (or, until Stage 5, would stream) through the same viewport-scoped path level 0 already uses. A level L>=1 cell is never dirtied by the originating lock event; only its own child's `onComposited` completion dirties it, once that child's bake has actually landed.
Why: marking every ancestor level dirty from the origin event (the first draft) let a parent bake from a sibling child that was itself still queued behind it, since the dirty set's dedup makes a second mark-parent-dirty a no-op once the first has already queued it; chaining the mark to each child's own completion instead makes that ordering bug impossible, since a parent is re-dirtied by every child that ever finishes after it, so it can never get permanently stuck on a stale one.
Revisit when: never expected at 4 levels; if a level is ever added, the same child-completion chaining generalizes with no new mechanism.

### 2026-07-26, backend-realtime, pyramid tile overlap is a fixed pixel count, not a scaled world-unit margin

Choice: a level 1-3 tile is built from its up to 4 children's full, uncropped canvases pasted at their 2x2 offsets onto a raw canvas, then resized down to the pyramid's one fixed per-tile pixel size (shared with level 0), the same fixed-pixel-overlap convention `slice-image.ts`'s reference-image Deep Zoom pyramid already uses (`overlap: 1`) rather than scaling level 0's world-unit margin up per level.
Why: margin is a constant number of world units regardless of level, but each pyramid level covers 4x the world area of the one below at the same fixed output pixel size, so a naive proportional carry-through would shrink margin's on-screen width every level, reaching a fraction of a pixel by level 2-3 (no seam allowance left at all). Pasting full uncropped children instead lets each level's own already-baked overlap propagate into the next at whatever pixel width it actually has, which shrinks more slowly (each level is a 2x downsample, not a re-derivation from the original world-unit margin) and never fully vanishes.
Revisit when: never expected; the same reasoning holds at any tile pixel budget.

### 2026-07-26, backend-realtime, level 0's R2 key shape stays bare; only levels 1-3 gain an L<level> segment

Choice: level 0 composites keep the existing `<puzzleId>/cells/<cellKey>/<version>.avif` key (see cell composites are version-suffixed immutable R2 objects); only level 1-3 objects add a segment, `<puzzleId>/cells/L<level>/<cellKey>/<version>.avif`.
Why: the live board already has 1296 level-0 objects baked under the bare key from the 995k lock test; renaming that shape would orphan every one of them (the superseded-version delete builds its key from the current template, so it would silently miss the real object sitting at the old path) for no benefit, since level 0 was never ambiguous on its own, only stacking further levels on top creates the collision a segment needs to resolve.
Revisit when: never expected.

### 2026-07-26, backend-realtime, region_state reports every pyramid level, deduped by ancestor

Choice: `CellComposite`/`SCellComposite` gain a `level` field (`PROTOCOL_VERSION` bump to 9). `streamRegionState`'s per-batch construction (`collectRegionCellComposites`) reports, for each level 0-3, every distinct ancestor of the batch's level-0 cells that already has a bake, deduping so several cells sharing one higher-level ancestor emit it only once; a live rebake's `cell_composite` push likewise fires for every level, scoped to that level's own (`2**level` times larger) world rect rather than always level 0's.
Why: a client zoomed out enough to want a coarser level needs that tile's version with no second round trip once it enters new cells, and a live rebake at any level needs to reach every viewer whose broadcast-scoped cells the now-larger tile actually overlaps, not just level 0's narrower footprint.
Revisit when: never expected; this is what Stage 4's own "no wire change yet" deferral was waiting on.

### 2026-07-26, frontend-canvas, CompositeTileLayer is the only rendering path for locked content

Choice: a new `CompositeTileLayer` (sibling to `LodTileLayer`, not merged into it: baking a live Pixi scene is synchronous, fetching a server AVIF is async with retry/timeout, different enough lifecycles to keep apart) picks one pyramid level per frame by a mipmap-style formula (`desiredLevel`: `log2(nativeDensity / (zoom * dpr))`, hysteresis-banded like `LOD_ENTER_ZOOM`/`LOD_EXIT_ZOOM` so a zoom sitting on a boundary does not thrash) and shows that level's covering tiles as `Sprite`s added directly to the existing `lockedPiecesLayer` (no new container needed: it already sits below `unlockedLayer` and the loose-piece LOD tile, which stays transparent wherever locked content lives since `bakeTile` no longer paints locked content into it at all). A level whose tile is not ready yet falls back to its already-hydrated finer children, recursively down to level 0 (`neededCompositeTiles`), so a coarse level still catching up never opens a gap where a finer tile already exists. Level 0 sprites use the exact margin-widened bounds Stage 3 already validated; levels 1-3 use the clean (non-widened) cell rect, stretched to fill it, since the server's true per-level margin bleed compounds non-linearly (see pyramid tile overlap above) and isn't worth reverse-engineering on the frontend for a sub-pixel seam. `hydrateLockedPiece`/`lockedHydrateQueue`/`lockedResident` and the whole per-piece fallback they existed for are removed rather than kept as a second path: a locked piece never gets its own fetch again, at any zoom.
Why: the pyramid's 4 levels form a clean mipmap chain across the app's whole usable zoom range (level 0 matches individual piece tiles' own native resolution exactly, so using it at every zoom is not a quality regression), and CompositeTileLayer's own byte-weighted budget (real decoded size, not a fixed "1 unit") replaces the pre-Stage-5 approximation that was safe only while composites were an opportunistic dedup on top of per-piece rendering, not the only path.
Revisit when: `COMPOSITE_VRAM_BUDGET_MB` (256, mirroring `LOD_VRAM_BUDGET_MB`) is an unmeasured default against a real multi-level pyramid's actual per-tile byte cost; tune once there is live data.

### 2026-07-26, frontend-canvas, salvage is the only bridge left, exempt from budget eviction

Choice: a piece anchored from the local client's own drag is still salvaged straight out of its dying `GroupNode` (reusing its already-hydrated texture, zero fetch); every other newly-locked piece (unhydrated, or no known owner) gets no individual rendering at all until a composite tile covers it. A salvaged node is freed only once `CompositeTileLayer.isPieceCovered` confirms a hydrated tile's per-hydrate `coveredPieceIds` snapshot actually includes that piece id (not merely that some tile's bounds contain its position, which a composite hydrated before the piece locked would already satisfy without actually drawing it), or once the piece leaves the wide keep ring (off-screen, so freeing it there is invisible). It is never subject to `evictResidentsOverBudget`: unlike a group or a composite tile, there is no re-fetch to recover a salvaged node freed early, so eviction pressure must never reach it.
Why: this is the one gap-closing exception the retired per-piece fallback used to cover for free; keeping the exact per-piece coverage snapshot (not a coarser point-in-bounds check) preserves the correctness Stage 3 already established, now scoped to the rare, self-limiting salvage population instead of every locked piece.
Revisit when: never expected; salvaged pieces are bounded by this client's own recent anchors and self-clear on the next debounced rebake.

### 2026-07-26, backend-realtime, no compositor configured means locked pieces do not render

Choice: an environment with no R2 write credentials (`config.r2Write` unset, local dev's default) never composites any cell, at any level; since Stage 5 retires the per-piece fallback entirely, locked pieces in such an environment render as nothing rather than degrading to individual fetches.
Why: matches the ROADMAP's literal instruction (the fallback is "removed rather than kept as a second path"); local dev without R2 credentials already showed zero server-composited tiles before this stage, relying on the per-piece path to cover for it, so this is a widening of an already-accepted local-only gap, not a new category of failure. Confirmed with the user before implementing.
Revisit when: never expected; set the R2 write credentials to see locked content in any environment, the same requirement compositing itself already had.

### 2026-07-27, qa-and-load, seed-lock-scenario locks pieces through the real grab/drop path

Choice: `seed-lock-scenario.ts` locks its chosen pieces by calling the real `handleGrab`/`handleDrop` (and so `applyMerge`) in-process, dropping each singleton at internal origin `(0, 0)`, instead of writing `piece:<id>.locked` and deleting the group directly in Redis. Origin `(0, 0)` is `handleDrop`'s `frameAnchor` path (see handlers.ts) because a piece's local AABB already bakes in its solved grid cell (`col * pieceSize, row * pieceSize`, see worldGrid.ts); origin is a pure translation on top of that, not the piece's own world position (an earlier version of this script passed the world position directly, which silently anchored nothing: `frameAnchor` was false for every piece off the very first cell, so every "lock" was actually just an ordinary unlocked move with no error). The script owns its own in-process Hub (no clients ever added, so every broadcast/send is a no-op) / GroupIndex / LockedPieceIndex / CellCompositor, and waits on `CellCompositor.whenIdle()` before exiting, mirroring `index.ts`'s own `onComposited` cascade so all 4 pyramid levels bake exactly as live play would.
Why: the direct-write shortcut never touched `CellCompositor.markDirty`, the one thing that populates the composite pyramid; the board was left with zero composites until two now-deleted backfill scripts (`backfill-cell-composite-level0.ts` plus the still-kept `backfill-cell-composite-pyramid.ts`) patched that gap after the fact, and the level-0 one still left a handful of cells permanently unbaked after retries. Driving the real handler path costs one real Redis/Mongo round trip per piece instead of one pipelined batch write, but produces the exact same state a live lock event would, with no separate backfill step and no possibility of the seeded board and the compositor's dirty-tracking disagreeing.
Revisit when: verified on prod's `synthetic-1m` at 10 000-piece scale (2026-07-27, after the origin fix above): 10 051/10 051 pieces locked, all 1 274/1 274 touched level-0 cells composited plus the full 324/324, 81/81, 25/25 at levels 1-3, no gaps at all (unlike the old direct-write approach's 5 permanently-failed cells). Direct inspection of several composited tiles (fetched from R2 and decoded) shows correctly-shaped pieces with distinct, correctly-placed content, no cross-contamination between pieces. Still not run at the real ~995 000-piece scale (throughput and the per-cell fetch fan-out at that scale remain unverified). Full client-side canvas rendering has not yet been visually confirmed end to end: an automated preview browser cannot force a render against the production build (rAF stays paused while the tab is backgrounded, and the prod Vue build strips the devtools hooks a manual-tick workaround would need), so a real-browser visual pass is still needed to confirm the wrong-content/position symptom is gone at the client rendering layer, not just the server compositing layer.
