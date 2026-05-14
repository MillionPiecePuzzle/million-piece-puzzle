# Million Piece Puzzle, Project Context

**Current work and progress are tracked in [ROADMAP.md](ROADMAP.md). Always consult it before starting a task and update it in the same commit.**

**Non-obvious development choices, especially ones known not to scale, are logged in [DECISIONS.md](DECISIONS.md). Append an entry whenever you make a trade-off worth revisiting later.**

## Development Guidelines (MUST FOLLOW)

- **English only.** All code, comments, commit messages, docs, identifiers, branch names, issue and PR titles and bodies are written in English. User-facing UI strings are also English by default (i18n comes later).
- **No em dashes (—).** Never use the em dash character in any output: code, comments, markdown, commit messages, chat replies. Use a period, a comma, parentheses, or a colon instead. The hyphen (-) is fine.
- **Code as documentation.** Prefer clear names and small functions over comments. Do not write comments that restate what the code does. Only comment to explain a non-obvious *why* (hidden constraint, workaround, surprising invariant). No multi-line docstrings unless a public API genuinely needs one.
- **Keep .md files in sync.** After any change that affects behavior, structure, stack, or workflow, update the relevant markdown (README.md, CLAUDE.md, package READMEs, ADRs). Treat docs drift as a bug. If a change makes a doc statement false, fix the doc in the same commit.
- **Challenge non-obvious implementations.** When a chosen approach has real trade-offs, hidden complexity, or a plausible simpler alternative, push back before implementing. Surface the trade-off in one or two sentences and let the user decide. Do not silently follow a questionable path.
- **Ask when the request is incomplete.** If a request leaves room for assumption (ambiguous scope, missing inputs, unclear acceptance criteria), ask a targeted question instead of guessing. One concrete question beats three speculative implementations.
- **Stay in scope.** Do not add features, refactors, abstractions, or "while I'm here" cleanups beyond what was asked. A bug fix does not need surrounding polish. If unrelated issues are spotted, mention them separately, do not bundle them.
- **No unnecessary files.** Do not create files the task does not require: no scratch notes, no planning docs, no example files, no README per folder. Markdown files only when they serve readers of the repo.
- **Prefer editing over creating.** Before creating a new file, check whether an existing file is the right home. New files only when the structure genuinely demands it.
- **No emojis in code.** No emojis in source, comments, commit messages, identifiers, or docs unless explicitly requested. UI strings are exempt when product design calls for them.
- **Short, direct replies.** Answer the question, skip the preamble and the trailing recap. Match length to the task: one-line answers for simple questions, structure only when it earns its keep.
- **One task at a time, ROADMAP-driven.** Always work on a single task identified in `ROADMAP.md`. Announce it and confirm the exit criterion before starting. Ask before moving to the next task.
- **Update ROADMAP status in the same commit.** Flip the checkbox `[ ]` to `[~]` when starting, to `[x]` when done, in the commit that touches the task. Never as a separate "docs" commit.
- **Verify before claiming.** When an API, library behavior, or infra detail is uncertain, verify it (read the docs, read the source, run the command, check online if needed) before writing code that depends on it. Do not fabricate.
- **No destructive ops without confirmation.** `git reset --hard`, `git push --force`, `rm -rf`, `docker volume rm`, dropping a collection, deleting a branch: always ask first, even when the context seems to imply it.
- **Conventional Commits.** Commit messages follow `type(scope): subject`, where `type` is `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`, and `scope` is the track name (e.g. `feat(piece-generation): add bezier edge sampler`).
- **Never reference past or removed things.** Do not mention abandoned approaches, removed code, deprecated decisions, or "we used to do X". Only describe what currently exists. If a doc still references something that no longer exists, fix the doc.

## Concept

A community-built online jigsaw puzzle: 1,000,000 pieces on a single shared canvas, all shuffled from the start, massively multiplayer, no time limit. Long-form event (weeks to months). Community-driven, non-commercial, open source.

## Product Pillars

- **Animation-heavy feel.** The experience must feel alive: cascade entrance when a puzzle session starts, tactile feedback on every drag/drop, satisfying snap animation when pieces lock, and a spectacle end-of-puzzle animation shared across all clients. All canvas animations are driven by the PixiJS ticker with easing, no external animation library.

## Architecture

Read/write split for scaling:
- Passive viewers receive cached snapshots via CDN (refreshed every ~2s)
- Active solvers connect via WebSocket for real-time updates

Three-tier event hierarchy:
- **Drag**: broadcast to viewport-neighbor clients only, no persistence
- **Drop**: Redis write + viewport broadcast
- **Snap** (pieces locking together): Redis + Mongo log + global broadcast

Locked pieces are permanent (no undo, no griefing).

## Data Model

### Gameplay model

- **Clusters.** Each piece belongs to a group. Initially every piece is its own group. When two pieces of compatible neighboring positions touch with the correct relative offset (within tolerance), their groups merge: all pieces of both groups share the resulting `groupId` and their relative positions are frozen.
- **Cluster drag.** Grabbing any piece grabs its whole cluster. All pieces of the cluster move together. Wire format broadcasts a single absolute position + `groupId`, not N piece positions.
- **Anchoring.** The puzzle frame (the rectangle from `(0,0)` to `(cols*pieceSize, rows*pieceSize)`) is the anchor. A cluster is anchored (permanently locked) when a human drop brings its origin within `snapTolerance` of `(0,0)`, or when it merges with an already-locked cluster. There is no special anchor piece. Once anchored, the cluster cannot be moved.
- **Rotation.** Reserved in the schema (`rotation` field, default 0) but disabled in Phase 0. May be enabled later based on user feedback without schema migration.

### Concurrency model

- The WebSocket server processes messages sequentially. There is always a total order even when two messages arrive in the same millisecond.
- Each group has a `heldBy` field (userId or null) updated atomically in Redis. First message to acquire the lock wins.
- Clients optimistically show the piece in hand for 50 to 100 ms while waiting for the server's authoritative answer.
- The server filters drag messages by `heldBy` ownership: only the winner's drag stream is broadcast to neighbors. From the outside it looks like only one person ever dragged the cluster.
- The loser receives a small rollback animation.

### Persistence

- Mongo schemas (TS source of truth): [packages/shared/src/db.ts](packages/shared/src/db.ts).
- Redis key patterns (TS source of truth): [packages/server/src/redis/keys.ts](packages/server/src/redis/keys.ts).

### What is intentionally not stored

- **Piece geometry** (Bezier params, canonical offsets): deterministic from `generationSeed`, recomputed client and server side at connection. No collection.
- **Drag events**: transient, broadcast only, never persisted.
- **Non-merging drops** (moving a piece without joining a cluster): not persisted. Current position is in Redis only.
- **User stats** (pieces snapped count, etc.): derived on demand from `ClusterMerge` aggregations. No precomputed counters until performance demands it.

### Stats derived from the model

- **Timelapse**: replay `ClusterMerge` by `at` in order. Geometry is reconstructed from `generationSeed`. Full canvas state at any timestamp is reproducible.
- **Per-piece attribution**: lookup the single `ClusterMerge` where the piece appears in `addedPieceIds`. Gives the user and timestamp.
- **Unique contributors**: `distinct(userId)` on `cluster_merges` filtered by `puzzleId`.
- **Live locked count**: `puzzle:{puzzleId}:locked-count` in Redis, broadcast on every anchoring event.

## Stack

### Frontend
- **Vue 3 + TypeScript + Vite**: UI shell
- **PixiJS**: WebGL canvas rendering for pieces (with frustum culling and LOD)
- **OpenSeadragon**: high-resolution viewing of the source image (reference panel, preview, replay, zoom-out LOD)
- Hosted on **Cloudflare Pages**

### Backend
- **Node.js + TypeScript**: WebSocket server and game logic
- **Redis**: live state of all pieces (~16-32 MB in memory)
- **MongoDB**: snap events log, user profiles
- **Auth.js**: authentication via OAuth providers (Google, Apple, Reddit), self-hosted in the Node server, Mongo adapter
- **GlitchTip** (self-hosted, Sentry-compatible): error monitoring
- All orchestrated by **Coolify** on a **Hetzner VPS**

### CDN & Storage
- **Cloudflare Pages**: frontend hosting
- **Cloudflare R2**: image tile pyramid + per-piece textures
- **Cloudflare CDN**: caches snapshots, sits in front of the VPS for SSL/DDoS
- **Cloudflare Web Analytics**: privacy-friendly traffic stats
- **Cloudflare Turnstile**: anti-bot on login

### Packaging
- **Docker** for the backend services
- **Coolify** handles deployment, SSL, reverse proxy (Traefik internally)

## Repo Structure

Open-source monorepo:
```
packages/
  shared/    # Shared TypeScript types (WS messages, piece schema)
  frontend/  # Vue + PixiJS + OpenSeadragon
  server/    # Node + WebSocket + Redis/Mongo handlers
```

GitHub Organization: `MillionPiecePuzzle`

## Image Pipeline
- Source image is preprocessed once with **libvips**:
  - Deep Zoom tile pyramid for OpenSeadragon (~3-5 GB on R2)
  - Per-piece AVIF textures, ~4 KB each, ~4 GB total on R2
- Stored hierarchically: `pieces/{folder:0000-0099}/{file:0000-9999}.avif`
- Source image target: 6-10 gigapixels (~80 px per piece minimum)
- No AI-generated content (community commitment)

## Piece Generation
- Procedural Bezier silhouettes with ~7 shape parameters per edge
- Continuous parameter sampling, every piece mathematically unique
- ~2 million unique edges across the puzzle
- 6 piece types based on tab/blank configuration

## User Flow

Landing page
- "Enter the canvas": Spectator mode (no auth, read-only)
- "Become a contributor": Auth.js OAuth login (Google, Apple, Reddit), then pseudo onboarding, then Player mode (can drag/drop pieces)

Mandatory authentication for contribution. Pseudo stored in Mongo and shown publicly for snap attribution.
