FROM node:20-alpine AS builder
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/frontend/package.json packages/frontend/package.json

RUN npm ci --ignore-scripts

RUN npm run build -w @mpp/shared \
 && npm run build -w @mpp/server

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV MPP_PUZZLE_ID=synthetic-1m
ENV MPP_ASSETS_BASE_URL=https://assets.millionpiecepuzzle.com
# MPP_GENERATION_SEED is intentionally NOT set here. It drives geometry, the
# scatter, and the wire id permutation, so it is the anti-programmatic-solving
# secret: baking it into this committed image would let anyone de-permute ids and
# regenerate silhouettes, defeating the whole opaque-wire design. It is passed
# through from the Coolify service env (docker-compose.yml), exactly like
# AUTH_SECRET, and must match the slicer's --seed for this puzzle's R2 assets.
ENV MPP_DEV_ENABLED=1

# Spectator stream cadence (keyframe + event-log windows). Baked as the prod
# source of truth: keyframe regenerated at most every 300s while live, 3s event
# windows, 6s interpolation delay, 900s event retention, 15s idle keyframe cache.
ENV MPP_KEYFRAME_INTERVAL_MS=300000
ENV MPP_EVENT_WINDOW_MS=3000
ENV MPP_INTERP_DELAY_MS=6000
ENV MPP_EVENT_RETENTION_MS=900000
ENV MPP_KEYFRAME_IDLE_TTL_MS=15000

# Node heap for the 1M board: the in-memory keyframe holds the whole board, which
# exceeds Node's ~2 GB default at 1M. Baked here (not a Coolify env knob) so the
# Coolify service env stays secrets-only; only meaningful on a box with the RAM
# (12 GB+ target). Co-located with Redis + Mongo, whose WiredTiger cache is capped
# in docker-compose.yml so the two do not fight for RAM.
ENV NODE_OPTIONS=--max-old-space-size=5120

# Scheduled public start (unix ms), mirrored into welcome/snapshot to sync the
# entrance cascade. 0 = no scheduled start (/play open, no countdown). Baked here
# by design, so scheduling the launch is a commit + Coolify rebuild.
ENV MPP_EVENT_STARTS_AT=0

# Non-secret prod config (auth host/cookie/origin + WS Origin allowlist). The
# secrets (AUTH_SECRET, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET) are set in the
# Coolify service environment, never here. docker-compose.override.yml overrides
# these with localhost values for local dev; Coolify deploys docker-compose.yml
# alone, so these baked values are the prod source.
ENV AUTH_URL=https://ws.millionpiecepuzzle.com
ENV AUTH_TRUST_HOST=true
ENV AUTH_COOKIE_DOMAIN=.millionpiecepuzzle.com
ENV MPP_APP_ORIGIN=https://app.millionpiecepuzzle.com
ENV MPP_ALLOWED_ORIGINS=https://app.millionpiecepuzzle.com

COPY --from=builder /repo/package.json /repo/package-lock.json ./
COPY --from=builder /repo/packages/shared/package.json packages/shared/package.json
COPY --from=builder /repo/packages/shared/dist packages/shared/dist
COPY --from=builder /repo/packages/server/package.json packages/server/package.json
COPY --from=builder /repo/packages/server/dist packages/server/dist
COPY --from=builder /repo/packages/frontend/package.json packages/frontend/package.json

RUN npm ci --omit=dev --ignore-scripts

EXPOSE 8080
CMD ["node", "packages/server/dist/index.js"]
