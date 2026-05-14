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
- [Server bootstrap reads puzzle config from a manifest file path](#2026-05-12-backend-realtime-manifest-bootstrap) -> replace with Mongo-backed puzzle catalog once Phase 1 manages multiple puzzles.
- [Snap detection compares group origins for equality within tolerance](#2026-05-12-backend-realtime-snap-by-origin) -> stable assumption; revisit only if canonical offsets stop being puzzle-global (e.g., rotation enabled).
- [Server Docker image installs all workspace runtime deps](#2026-05-12-backend-realtime-docker-all-workspace-deps) -> trim once image size matters.
- [Piece outline approximated by 8 cubic Beziers per curved edge](#2026-05-13-piece-generation-edge-path-topology) -> revisit if silhouettes look degenerate or if a tighter approximation is needed for snap visuals.
- [Vite dev middleware serves `generated/<id>/` at `/puzzle/`](#2026-05-12-frontend-canvas-vite-puzzle-middleware) -> drop once Phase 1 points the frontend at R2 and the slice output no longer needs a local HTTP face.
- [Piece hit testing uses the sprite bounding rect, not the mask silhouette](#2026-05-12-frontend-canvas-bounding-rect-hits) -> revisit once overlap zones between adjacent unmerged pieces produce confusing pickups.
- [Drag broadcasts sent on every pointermove without throttling](#2026-05-12-frontend-canvas-drag-no-throttle) -> coalesce with requestAnimationFrame once the WS shows backpressure or high-rate mice flood the server.
- [Global serial dispatch queue for all WS messages](#2026-05-14-backend-realtime-global-serial-dispatch-queue) -> move to per-group (or per-shard) queues in Phase 1+ so independent groups progress in parallel.
- [Cascade entrance animation descoped from Phase 0 to Phase 2](#2026-05-12-frontend-canvas-cascade-deferred) -> requires event scheduling (`eventStartsAt`) and a landing countdown to be meaningful; building it now would mean rebuilding it twice.

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

### 2026-05-12, backend-realtime, manifest bootstrap

Choice: the server reads `MPP_MANIFEST` (path to the slicer's `manifest.json`) at boot to obtain `puzzleId`, `seed`, `rows`, `cols`, `pieceSize`. If Redis has no meta for that puzzle, it runs `generatePuzzle` to derive geometry and writes initial state (one group per piece, anchor group `0` locked at world origin, others scattered deterministically). If meta already exists, it is reused.
Why: keeps the single-puzzle Phase 0 loop trivial and aligned with the slicer's existing output. No catalog, no admin UI, no extra service.
Revisit when: multiple puzzles or admin tooling appear. Move the catalog to Mongo and let the server load by `puzzleId` from there.

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

### 2026-05-12, frontend-canvas, Vite puzzle middleware

Choice: in dev, a small Vite middleware in `packages/frontend/vite.config.ts` serves `<repo>/generated/<MPP_PUZZLE_ID:default test>/` at `/puzzle/*`. The slice script keeps writing to `generated/<id>/`, the server keeps reading the manifest via its existing volume mount, and the frontend fetches `/puzzle/manifest.json` plus tiles relative to it.
Why: avoids copying artifacts into `packages/frontend/public/`, keeps `generated/` as the single source of truth, and serves the manifest at the stable dev URL `http://localhost:5173/puzzle/manifest.json`.
Revisit when: production deployment points the frontend at R2 (Phase 1). The middleware is dev-only and can be removed once tiles live on a CDN.

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

Choice: every incoming WS message, across all clients, is appended to a single process-wide promise chain and runs to completion before the next starts.
Why: handlers `await` Redis between reads and writes; without serialization two messages can interleave on those points and corrupt group state. A global chain makes the "server processes messages sequentially" invariant literally true with one line and no locking logic.
Revisit when: throughput matters (Phase 1+). A global queue serializes unrelated clients needlessly; the natural follow-up is per-group (or per-shard) queues so independent groups progress in parallel while still ordering messages that touch the same group.
