# `@mpp/load-test`

WebSocket load harness for the MPP server. Spawns N bots that each open a real
WS connection and run a continuous grab/drag/drop loop with periodic viewport
and cursor presence. Records grab latency, drag/drop throughput, server
errors, and backpressure closes; emits a PASS/FAIL verdict at the end.

The bot uses the same `@mpp/shared` types as the real client, so the wire
format is exact.

## Usage

```bash
# Local docker-compose (puzzle pre-loaded via MPP_PUZZLE_ID + MPP_ASSETS_BASE_URL).
npm run start -w @mpp/load-test -- \
  --target ws://localhost:8080 \
  --puzzle test-puzzle-10k \
  --origin http://localhost:5173 \
  --bots 20 --duration 300

# Prod.
npm run start -w @mpp/load-test -- \
  --target wss://ws.millionpiecepuzzle.com \
  --puzzle test-puzzle-10k \
  --origin https://app.millionpiecepuzzle.com \
  --bots 20 --duration 300
```

## Flags

| Flag                | Default                  | Meaning                                                |
| ------------------- | ------------------------ | ------------------------------------------------------ |
| `--target`          | (required)               | WS URL (`ws://...` or `wss://...`)                     |
| `--puzzle`          | (required)               | Puzzle id sent in `hello`                              |
| `--origin`          | `http://localhost:5173`  | `Origin` header, must match `MPP_ALLOWED_ORIGINS`      |
| `--bots`            | `20`                     | Concurrent simulated clients                           |
| `--duration`        | `300` (sec)              | Total run length                                       |
| `--spawn-interval`  | `250` (ms)               | Delay between bot connects, to avoid a thundering herd |
| `--seed`            | `42`                     | Seed for the per-bot RNG (reproducible runs)           |
| `--verbose`         | off                      | Log per-bot server errors and ws errors                |

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
