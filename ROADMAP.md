# Roadmap

Work is tracked by version. v1.0 is live in prod, v1.1 is the version being built. The eleven tracks below cut across every version. A version ships only when its exit criterion is met, and each task carries an exit criterion, not a description. Detail on non-obvious choices lives in [DECISIONS.md](DECISIONS.md); done tasks here are kept terse.

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

## Before v1.0

Four milestones, all met, condensed to what they achieved. The detail lives in the code and in [DECISIONS.md](DECISIONS.md).

### Local MVP

A single user completed a puzzle of N configurable pieces in a browser, with the full architecture running locally (WS server + Redis + Mongo via docker-compose), in anonymous mode.

### Closed Alpha

5 to 20 invited people, connected concurrently, completed a 10 000-piece puzzle on a deployed instance. Performance was pulled forward and built as the real solution rather than a stopgap: drag coalescing, per-group dispatch queues, zoom-out LOD, per-IP rate limiting. Viewport and write sharding stay deferred, blocked on the single-writer topology, not on piece count.

### Public 1M

The puzzle opened to the public with 1 000 000 unique pieces on a single shared canvas, full auth and legal documents in place: the gigapixel image pipeline on R2, viewport-sharded broadcasts backed by a group index and partial-state resync, PixiJS LOD with viewport-driven texture streaming, Auth.js with Google, the admin ops page, the frontend on Cloudflare Pages, EN/FR/ES/DE throughout, and load tests to 10 000 clients.

### Open Access (guest-first)

A first-time visitor reaches the canvas and places a piece with no OAuth redirect: a guest identity is minted in-site and the pseudo and country are asked in-app, and signing in with Google claims those contributions under one persistent identity. A single real-time path serves everyone, gated by an admission queue past a global connection cap, and the spectator read-path was retired down to its DNS record.

---

## v1.0, Launch Readiness, RELEASED

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

## v1.1, IN PROGRESS

**Exit criterion**: every task below shipped to prod. Tasks are promoted from the backlog as they are decided, so the list grows until the version is cut.

### `frontend-shell`

- [x] The account menu carries a stepped tips strip (one-line hints, an arrow on either side, no screen of its own) and the leaderboard panel an info control opening a scoring explainer: one point per piece credited once, why the standings run ahead of the locked counter, why snapping a 30-piece cluster credits one point and not thirty. EN/FR/ES/DE

### `backend-realtime`

- [x] The standings move on every merge, not only on an anchoring lock: a scoring merge marks its contributor dirty and a coalescing publisher sends only the rows that moved inside the top 100 (at most one publish per 2s window, the first merge of a quiet window going out immediately), folded client-side into the list already held. A contributor ranked outside that top 100 gets their own tally and rank on their own socket, on join and whenever it moves, so the panel pins their row instead of showing them nothing. See DECISIONS
- [x] Every piece on a finished board has exactly one owner, so the standings add up to the full million: an anchoring merge credits the whole set it locks, not just the dragged side, closing the case where a piece that only ever sat on the receiving end locked with nobody credited for it. The log replay unions the same two arrays, so prod's existing merges are re-credited at the next boot with no migration. See DECISIONS

### `frontend-canvas`

- [x] Personal viewport flags: a desktop player keeps up to 8 personal markers on the board, created from a `+` control in a bottom-center HUD bar and persisted per browser in `localStorage` under the puzzle id. Clicking a flag's button, or pressing its 1-8 key, centers the camera on it instantly and carries a sticky-carried cluster along. Each flag draws in the canvas one and a half pieces tall at every zoom and on both minimaps in its own color, can be dragged aside within the play zone, and opens a popover with a delete action and the 8-color palette, where picking a color already held by another flag swaps the two. The bar is hidden under the responsive breakpoint (pointer-driven flow, no room next to the ticker and the minimap); the toast and the carry hint move above it, and the tips strip gains a line. EN/FR/ES/DE. See DECISIONS
- [x] A player can show the source photo faintly under the board, so a piece's home is visible before anything around it is locked: `DziRevealLayer` mirrors the DZI tiles it already streams into an unmasked layer above the frame and below every piece, at 0.32 group opacity, and locked content stays unmistakably on top of that ghost by casting a 3-screen-pixel shadow drawn from the combined mask. The choice is a player display setting, persisted per browser and reached from a Display section in the options menu, off by default. EN/FR/ES/DE. See DECISIONS
- [x] A piece is sent to a flag by dropping it on that flag's button in the bottom-center bar: the cluster shrinks while it hovers a button (edge-pan suppressed there, so the bar's own screen band no longer scrolls the board), and releasing lands it on a clear patch beside the flag, searched outward against the locally known clusters and locked pieces, with the camera left exactly where the player was working. Only the HUD bar takes the drop, not the canvas or minimap markers. A camera jump made while a cluster is carried (a flag button, a 1-8 key, the minimap, fit/center) re-glues it to the cursor before the residency pass rather than after, so it is no longer dehydrated for having been left behind at the old spot and left invisible until the next camera move. EN/FR/ES/DE. See DECISIONS

### `auth-and-accounts`

- [x] Syncing with Google produces a permanent account that reads as one: the sign-in promotes the guest document the provider account is linked onto (`guest` cleared, OAuth email/name/image stored) instead of leaving it flagged as a guest, and the options menu answers with a checked "Synced with Google" row carrying the linked address in place of the action. The seven accounts already linked in prod are backfilled from the identity in their stored `id_token`. Both provider entries carry their mark (the Google G, the Discord logo). See DECISIONS
- [x] A player gets back into a synced account from a second device or after the session cookie ages out: the onboarding pseudo step carries a sign-in entry (the one step with no session, where Auth.js resolves the account straight to its profile), and a player already minted as a guest is offered the switch instead of Auth.js's refusal page, dropping the session so the next attempt lands in the account and folding this browser's guest into it, credits included. Claim tokens survive a sign-in abandoned at Google, an absorbed guest never renames the account, and the live standings follow the fold. See DECISIONS

### `infra-deploy`

- [x] A restart or an outage never reads as the player's own connection failing: the server announces the shutdown (maintenance notice, then WS close 1012) before dropping sockets, and every client (in game, arriving, or on the landing) lands on a localized "puzzle unavailable, back in a few minutes" screen served entirely from Cloudflare Pages, which reloads itself back into the board once the server answers again. See DECISIONS

---

## Backlog

Ideas and open fixes worth keeping but not yet committed to a version. Promote into a version track when scope and timing are clear.

- **Locale-prefixed URLs for search.** The SEO metadata work (v1.0) is English-only because locale is chosen client-side (`localStorage`/browser language) with no URL segmentation, so a search engine can only index one language version of `/`. Ranking for non-English queries (e.g. French "puzzle le plus grand") needs its own crawlable URL per locale (`/fr/`, `/es/`, `/de/`), native-language meta strings, hreflang alternates, and rewiring every internal link (language switcher, router pushes) to a locale-aware path: a router restructuring, not a metadata tweak. See [DECISIONS](DECISIONS.md#2026-08-17-frontend-shell-seo-metadata-is-english-only-corrected-per-route-in-js-rather-than-per-locale).
- **Dynamic max-zoom that grows with progress.** Cap zoom-out early and relax it as pieces are placed, to bound the visible piece count. A fixed 15% zoom floor already exists (see [play-zone hard limits](DECISIONS.md#2026-05-21-frontend-canvas-play-zone-hard-limits)); the progress-relative version is the open idea.
- **Coordinate HUD overlay.** Small overlay showing viewport position (XY, sector, zoom). Needs a "sector" concept first. Revisit at 1M when orientation becomes a real problem.
- **Firewall the origin to Cloudflare IP ranges.** Closes the last DDoS gap: the VPS is still directly reachable so the edge is bypassable and `CF-Connecting-IP` is spoofable. Steps in [DECISIONS topology](DECISIONS.md#2026-05-18-infra-deploy-alpha-topology).
- **Locked vs unlocked piece differentiation.** Locked and unlocked content already render through separate layers (`DziRevealLayer` against `unlockedLayer`), so a per-layer treatment (contrast, saturation, seam emphasis, an outline on free pieces) costs nothing per piece. Zoom-out LOD bakes tiles, so a per-piece effect such as a drop shadow will not survive the LOD band while a per-layer color treatment will. Direction still open: make free pieces stand out, or make locked content recede.
- **Toggleable HUD windows.** Each panel individually hidable, driven by mobile where the four panels leave little room for the board. This is the mobile navigation the responsive pass already named as its own revisit condition (see [DECISIONS](DECISIONS.md#2026-08-06-frontend-shell-responsive-hud-shrinks-panels-instead-of-hiding-them)): panels collapse into a real control surface instead of shrinking further. On a phone an always-visible icon bar beats a setting buried in a modal, and that bar competes for the same screen edge as the flag bar, which already sits bottom-center on desktop.
- **Shareable viewport deep link.** `/play` accepting a position and zoom in the query string, so a spot on the board can be linked in Discord ("help here") or bookmarked outside the app. Sibling of the personal flags and the natural way to share one, which they deliberately are not (strictly personal, client-side). No secret is exposed: board coordinates are already client-visible, unlike the seed-permuted piece ids.
- **Per-piece attribution.** Who placed a given piece, and when, surfaced on a locked piece in the canvas. The data model already answers it with no new storage (the first `ClusterMerge` by `at` whose `droppedPieceIds` contains the piece), so the work is a lookup route, the matching index, and the UI affordance. Pairs with the leaderboard explainer: it makes the scoring rule visible on the board itself.
- **Timelapse.** Replay the board's assembly by walking `ClusterMerge` in `at` order, geometry reconstructed from `generationSeed`. Designed for since the start, never built, and a project in its own right rather than a feature to slip into another chantier. The obvious payoff is shareable footage of a months-long build.
- **`GET /auth/session` answers with more than the session user.** Auth.js's database strategy hands the callback the adapter session spread over the whole user document and returns whatever the callback returns, so the response body carries the raw `sessionToken` (the credential the cookie keeps `httpOnly`) and every field on the user, `claimTokenHash` included. Trimming it to the fields the SPA reads is a few lines in the `session` callback in `auth.ts`; the exposure only pays off for an attacker who already has script execution on the app origin, which is why it is here rather than in a version.
