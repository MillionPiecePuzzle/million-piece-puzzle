# `@mpp/load-test`

WebSocket load harness for the MPP server. Spawns N bots that each open a real
WS connection and run a continuous grab/drag/drop loop with periodic viewport
and cursor presence. Records grab latency, drag/drop throughput, server
errors, and backpressure closes; emits a PASS/FAIL verdict at the end.

The bot uses the same `@mpp/shared` types as the real client, so the wire
format is exact. It follows protocol v3: `welcome` carries no board, so each bot
streams its region in via `region_state` for the cells its (bounded) viewport
enters, then grabs from what it has learned.

## Sessions

The WS upgrade rejects anonymous connections: it resolves the session cookie
against Mongo via the Auth.js adapter. Sign-in is Google OAuth only with no
programmatic path, so the harness seeds one disposable user + session per bot
directly in Mongo (in the adapter's document shape) and sends the matching
session cookie on each upgrade. Seeded docs are tagged `loadTest: true` with a
per-run `runId` and use `@loadtest.invalid` emails; they are deleted at the end
of the run (pass `--keep-sessions` to leave them, e.g. for inspection or to
clean a crashed run with `db.users.deleteMany({ loadTest: true })`).

This means the harness needs a Mongo connection to the **same database the
target server reads**. Locally, `docker-compose.override.yml` exposes Mongo on
`localhost:27017`. In prod Mongo is not publicly exposed, so point `--mongo` at a
tunnel (or run the harness on the VPS). No auth secrets are required: database
sessions are an opaque token looked up in Mongo, so the gate accepts a seeded
session even when `AUTH_SECRET` is unset.

## Usage

```bash
# Local docker-compose (puzzle pre-loaded via MPP_PUZZLE_ID + MPP_ASSETS_BASE_URL).
npm run start -w @mpp/load-test -- \
  --target ws://localhost:8080 \
  --puzzle test-puzzle-10k \
  --origin http://localhost:5173 \
  --mongo mongodb://localhost:27017 --mongo-db mpp \
  --bots 5 --duration 300

# Prod (Mongo reached over a tunnel, wss target selects the __Secure- cookie).
npm run start -w @mpp/load-test -- \
  --target wss://ws.millionpiecepuzzle.com \
  --puzzle test-puzzle-10k \
  --origin https://app.millionpiecepuzzle.com \
  --mongo mongodb://localhost:27017 --mongo-db mpp \
  --bots 5 --duration 300
```

All bots from one host share one IP, so the server's per-IP concurrent
connection cap (`MPP_WS_MAX_CONNECTIONS_PER_IP`, default 10) bounds how many
connect from a single machine: raise it on the server, spread bots across hosts,
or use `--spoof-ip-base` (below) to run more than that without `1013` closes.

## Bypassing the per-IP cap (`--spoof-ip-base`)

`--spoof-ip-base 198.51.100.0` makes each bot send a distinct `CF-Connecting-IP`
(base + bot index, e.g. bot 0 -> `198.51.100.0`, bot 49 -> `198.51.100.49`), so
the server buckets every bot as its own IP and the per-IP connection cap and
message-rate bucket apply per bot, not per host. No server config change is
needed. Use the `198.51.100.0/24` (TEST-NET-2) range so the synthetic IPs are
obviously not real.

This only works when the bots reach the **origin directly**: `clientIp` trusts
`CF-Connecting-IP`, but Cloudflare overwrites that header at the edge, so a
`wss://ws.*` (proxied) target ignores the spoof. Point `--target` at the origin
(the VPS host/port, or an SSH tunnel to it) to skip the edge. It rides the
unfirewalled-origin gap (see DECISIONS: alpha topology); for a load test we
control, that gap is the lever.

## State-corruption validator

The harness verdict covers transport saturation only. To check the board itself
is uncorrupted, run the validator (in `@mpp/server`) after the bots stop, with
the board at rest, pointed at the same Redis and Mongo the target server uses:

```bash
npm run validate-state -w @mpp/server -- \
  --redis redis://127.0.0.1:6379 \
  --mongo mongodb://127.0.0.1:27017 --mongo-db mpp \
  --puzzle test-puzzle-10k
```

It asserts piece/group partition consistency, group-size and locked-count
accounting, no leftover holders, and, the strongest check, that replaying the
`cluster_merges` log reconstructs the exact Redis partition (the timelapse
property). It prints a per-check report and exits non-zero on any failure. Give
the server a few seconds after stopping the bots so disconnect-time held-group
releases drain before reading. For prod, Redis and Mongo are not publicly
exposed: run it on the VPS, or over an SSH tunnel to those ports.

## Flags

| Flag                | Default                     | Meaning                                                       |
| ------------------- | --------------------------- | ------------------------------------------------------------ |
| `--target`          | (required)                  | WS URL (`ws://...` or `wss://...`); `wss` selects the `__Secure-` cookie |
| `--puzzle`          | (required)                  | Puzzle id sent in `hello`                                     |
| `--origin`          | `http://localhost:5173`     | `Origin` header, must match `MPP_ALLOWED_ORIGINS`            |
| `--mongo`           | `mongodb://127.0.0.1:27017` | Mongo URL the seeder writes test sessions to                 |
| `--mongo-db`        | `mpp`                       | Mongo database name (must match the server's `MPP_MONGO_DB`) |
| `--bots`            | `20`                        | Concurrent simulated clients                                 |
| `--duration`        | `300` (sec)                 | Total run length                                              |
| `--spawn-interval`  | `250` (ms)                  | Delay between bot connects, to avoid a thundering herd        |
| `--viewport-frac`   | `0.1`                       | Bot viewport span as a fraction of the play zone (keep small so it stays a scoped subscriber) |
| `--seed`            | `42`                        | Seed for the per-bot RNG (reproducible runs)                 |
| `--keep-sessions`   | off                         | Skip teardown of the seeded users/sessions                   |
| `--spoof-ip-base`   | off                         | Per-bot `CF-Connecting-IP` (base + bot index) to bypass the per-IP cap; origin-direct only (see below) |
| `--verbose`         | off                         | Log per-bot server errors and ws errors                      |

## Verdict

The final line prints `PASS` when all of the following hold:

- Zero WebSocket closes with code `1013` (backpressure, see DECISIONS:
  WS hardening).
- Zero `ws` library errors raised on any bot.
- Server `error` frames stay below 5% of grab attempts.

Otherwise `FAIL`, look at the per-metric breakdown above it. Grab round-trip
latency is reported (p50/p95/p99/max) but not gated: at alpha scale on a
single VPS, multi-second p95 under 20-bot sustained drag traffic is an
architecture cost (the single-process WS writer), not a saturation signal.
See DECISIONS: harness PASS criterion bounded to saturation signals.

## What is and is not exercised

The bot generates random target positions inside the play zone, so the
snap/merge path is hit only opportunistically. The high-rate paths under load
(drag broadcast fan-out, drop with snap detection that returns null) are
exercised on every cycle, which is the bottleneck the test cares about.

Server-side metrics (heap, queue depth) are not collected directly. Use OS
tools (`top`, Coolify dashboard) alongside the run if you need them.
