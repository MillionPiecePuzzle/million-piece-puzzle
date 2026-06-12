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
ENV MPP_PUZZLE_ID=test-puzzle-10k
ENV MPP_ASSETS_BASE_URL=https://assets.millionpiecepuzzle.com
# Server-only generation seed: drives geometry, scatter, and the wire id
# permutation. Never in the public manifest (a client could otherwise regenerate
# silhouettes and de-permute ids). Must match the slicer's --seed for this puzzle.
ENV MPP_GENERATION_SEED=test-puzzle-10k-2026
ENV MPP_DEV_ENABLED=1

# Spectator stream cadence (keyframe + event-log windows). Baked as the prod
# source of truth: keyframe regenerated at most every 300s while live, 3s event
# windows, 6s interpolation delay, 900s event retention, 15s idle keyframe cache.
ENV MPP_KEYFRAME_INTERVAL_MS=300000
ENV MPP_EVENT_WINDOW_MS=3000
ENV MPP_INTERP_DELAY_MS=6000
ENV MPP_EVENT_RETENTION_MS=900000
ENV MPP_KEYFRAME_IDLE_TTL_MS=15000

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
