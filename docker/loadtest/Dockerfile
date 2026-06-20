# Throwaway image to run the WS load harness and the state-corruption validator
# from inside the prod Docker network, so neither needs a tunnel or a per-IP cap
# change: the bots reach the server directly (ws://server:8080) and spoof a
# distinct CF-Connecting-IP each, and the validator reads redis/mongo by service
# name. Build it on the VPS and run it on the stack network (see
# packages/load-test/README.md). Not part of the Coolify deploy.
FROM node:20-alpine
WORKDIR /repo

# Same workspace layout the server image installs: all package.json files must be
# present for `npm ci` to wire the workspaces; @mpp/shared is built because both
# the harness and the validator import it.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/load-test packages/load-test
COPY packages/frontend/package.json packages/frontend/package.json

RUN npm ci --ignore-scripts && npm run build -w @mpp/shared

COPY docker/loadtest/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
