# Deployment

Production stack for the Closed Alpha (Phase 1):

- **Server, Redis, Mongo**: Hetzner VPS, orchestrated by Coolify, exposed via Traefik + Let's Encrypt.
- **Frontend**: Cloudflare Pages, built from this repo, talking to the server over `wss://`.

Local development uses the same repo but a different compose shape, see [`docker-compose.override.yml`](docker-compose.override.yml). Coolify reads `docker-compose.yml` only.

## 1. Hetzner VPS

1. Create a Cloud Server. Minimum spec for the alpha: `CX22` (2 vCPU, 4 GB RAM, 40 GB SSD). Image: Ubuntu 22.04 LTS. Region near the target audience.
2. Add an SSH key during creation.
3. Note the public IPv4 address.

Optional but recommended: open ports `80`, `443`, `22`, `8000` (Coolify dashboard) on the Hetzner Cloud Firewall. Block everything else.

## 2. Initial SSH

```sh
ssh root@<vps-ip>
apt update && apt upgrade -y
```

Create a non-root user if desired; for the alpha, root via SSH key is acceptable.

## 3. Install Coolify

On the VPS, as root:

```sh
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

The script installs Docker Engine, pulls Coolify images, and starts the dashboard on port `8000`. When it finishes, open `http://<vps-ip>:8000` in a browser and create the first admin account immediately (anyone reaching the URL before you can claim it).

In **Settings -> General**, set the Coolify instance domain to a sub-domain you control (for example `coolify.<your-domain>`). Coolify will then issue an SSL cert for the dashboard itself.

## 4. DNS in Cloudflare

For each sub-domain pointing at the VPS, add an `A` record:

| Name             | Type | Value      | Proxy status                  |
| ---------------- | ---- | ---------- | ----------------------------- |
| `coolify`        | A    | `<vps-ip>` | DNS only (grey cloud)         |
| `ws` (server)    | A    | `<vps-ip>` | DNS only (grey cloud) for now |
| `app` (frontend) | -    | -          | created by Cloudflare Pages   |

Reason for "DNS only": Coolify's Traefik handles Let's Encrypt directly via HTTP-01. If Cloudflare proxy is on, the challenge response goes through Cloudflare and can fail or loop. Once the cert is issued you can switch to "Proxied" (orange cloud) and re-issue via Cloudflare's edge cert; that is a separate step left for later.

## 5. Backend on Coolify

In the Coolify dashboard:

1. **Projects -> + Add** -> name it `mpp-alpha`.
2. Inside the project, **+ New Resource -> Docker Compose Empty** (or **Public Repository** if pointing at the GitHub repo). For a git-based deploy:
   - Repository: this repo's URL, branch `main`.
   - Build Pack: `Docker Compose`.
   - Docker Compose Location: `docker-compose.yml` (default).
3. **Domains**: assign `ws.<your-domain>` to the `server` service (port `8080`). Leave `redis` and `mongo` with no domain. The `frontend` service can stay without a domain too (Pages handles that), or assign a backup domain like `vite.<your-domain>` if you want a fallback.
4. **Environment Variables** for the application:
   - `VITE_WS_URL` = `wss://ws.<your-domain>/`
   - `MPP_ALLOWED_HOSTS` = whichever host you point at the `frontend` service, or leave empty if no public domain on `frontend`.
5. **Persistent Storage**: Coolify will reuse the named volumes `redis-data` and `mongo-data` from the compose file. No extra config needed.
6. **Deploy**. Coolify clones, builds the server image (which bakes `generated/test/`), starts the stack, and wires Traefik for the assigned domains.

Wait for the build to finish, then verify:

```sh
curl -I https://ws.<your-domain>/
# expect 426 Upgrade Required from the WS server, with valid TLS
```

## 6. Frontend on Cloudflare Pages

In the Cloudflare dashboard:

1. **Workers & Pages -> Create -> Pages -> Connect to Git** -> select the repo.
2. Production branch: `main`.
3. Build settings:
   - Framework preset: `None` (custom).
   - Build command: `npm ci && npm run build -w @mpp/shared && npm run build -w @mpp/frontend`
   - Build output directory: `packages/frontend/dist`
   - Root directory: leave blank (repo root).
   - Node version: `20` (set via env var `NODE_VERSION=20`).
4. **Environment variables** (Production):
   - `VITE_WS_URL` = `wss://ws.<your-domain>/`
   - `NODE_VERSION` = `20`
5. Deploy. Cloudflare runs the build; the Vite `mpp:bundle-puzzle` plugin copies `generated/test/` into `dist/puzzle/` so the manifest and AVIF tiles ship with the build.
6. **Custom domain**: in the Pages project, add `app.<your-domain>`. Cloudflare creates the CNAME and provisions a cert automatically.

Once both deploys are green, navigate to `https://app.<your-domain>/play`. The browser fetches the manifest from `/puzzle/manifest.json` (served by Pages) and opens a `wss://ws.<your-domain>/` connection to the server.

## 7. Environment variable matrix

| Variable            | Where                    | Value                                                  |
| ------------------- | ------------------------ | ------------------------------------------------------ |
| `MPP_PORT`          | server (compose)         | `8080`                                                 |
| `MPP_REDIS_URL`     | server (compose)         | `redis://redis:6379`                                   |
| `MPP_MONGO_URL`     | server (compose)         | `mongodb://mongo:27017`                                |
| `MPP_MONGO_DB`      | server (compose)         | `mpp`                                                  |
| `MPP_MANIFEST`      | server (Dockerfile ENV)  | `/app/generated/test/manifest.json`                    |
| `VITE_WS_URL`       | frontend (build-time)    | `wss://ws.<your-domain>/`                              |
| `MPP_ALLOWED_HOSTS` | frontend (runtime, Vite) | comma-separated hostnames Vite accepts, or `*` for any |
| `NODE_VERSION`      | Cloudflare Pages         | `20`                                                   |

## 8. Updating after a code change

- **Backend**: push to `main`. In Coolify, either enable auto-deploy on push or click `Redeploy`. Coolify rebuilds the image with the new code.
- **Frontend**: push to `main`. Cloudflare Pages auto-builds and promotes.

If the alpha puzzle (`generated/test/`) changes, both sides must be rebuilt: server image bakes it in, Pages bundle copies it during build.

## 9. Known gaps for Phase 1

- Mongo and Redis run without authentication on the docker network. Acceptable while the host firewall blocks public access to those ports; revisit before the public Phase 2.
- WS traffic transits Cloudflare-DNS-only on `ws.<your-domain>`. Flipping to Proxied later (orange cloud) requires the Cloudflare WebSocket allowance to be on (it is, on all plans) and Coolify's cert to remain valid behind it.
- R2 buckets for tiles and per-piece textures are not used yet. They are a separate task in `infra-deploy` and the image pipeline track.
- The `generated/test/` fixture is committed to the repo for image baking. Once the image pipeline pushes to R2, switch the server and Pages build to fetch from R2 and stop committing the fixture.
