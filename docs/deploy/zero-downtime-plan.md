# Zero-downtime deploys: plan (2026-10-13)

Julio: "fix the problem with the deploy so it never goes down".

## What happens today (verified)

`chat.zilar.app` is one Coolify **Docker Compose** Application (`zilar-chat`, uuid `qccydpow4rw0zcel9yisk44s`), built from `deploy/coolify/docker-compose.app.yml`. It holds four services: postgres, ejabberd, server and web.

- **Every push to a watched path redeploys the whole stack.** The deploy log of `263325d` (2026-10-12 22:38 UTC) shows "Removing old containers" at 22:39:35 and "Starting new application" at 22:40:09, with **all four** containers recreated under new timestamped names. The site answered 502 from about 22:39:35 to 22:40:28: about 53 s per deploy.
- **ejabberd restarts every time**, so every client's chat connection drops, and phones asleep in push mode lose their session (OPS-4, confirmed).
- **Coolify can't do better with Compose.** Its docs (Applications → Deployments → Rolling Updates): "Rolling updates are not supported for Docker Compose applications." Rolling updates (start the new container, wait for its health check, then stop the old one) exist only for Dockerfile, Nixpacks, Static and Image apps.
- **On 2026-10-12 the lead merged about 10 tasks in a row**, which made 6 deploys in 12 minutes, so the site was down much of that time.

## Plan

### Phase 0: now (code only; T-1304 and lead practice)
- **T-1304:** the apps never send a user to login on a 5xx, timeout or offline; only a 401 signs out.
- **Lead practice until Phase 2:** merge in batches and push code to `main` at most once every 30 minutes. A push that touches only `work/` or `docs/` doesn't deploy (watch paths).

### Phase 1: small code changes (a worker task, no production change)
- **Health checks:** `start_interval: 1s` on every health check, so a new container counts as healthy in about 1–2 s instead of 10–15 s.
- **Caddy retries:** in `apps/web/Caddyfile`, `lb_try_duration 30s` and `lb_try_interval 250ms` on the `/api`, `/xmpp-ws` and `/upload` proxies, so requests wait for a restarting upstream instead of failing.
- **Rule for migrations: expand/contract only.** In Phase 2 the old server keeps running while the new one migrates, so a release never drops or renames something the running server still uses (OPS-5).

### Phase 2: split the stack (production change, Julio's OK)
1. **`zilar-chat` (existing app) keeps only postgres and ejabberd.** Its volumes stay where they are, and no data moves.
   - Watch paths become `deploy/postgres/**` and `deploy/ejabberd/**`, so app code pushes never restart them.
   - "Connect to the predefined network" is turned on, so the new apps reach `postgres` and `ejabberd` by name.
2. **New Dockerfile app `zilar-server`** (`apps/server/Dockerfile`):
   - domain path `https://chat.zilar.app/api`, health check `GET /health`;
   - watch paths `apps/server/**` and `packages/**`;
   - it mounts the existing `sticker-data` and `avatar-data` volumes;
   - **its environment needs the same secrets as today. Julio copies them in the Coolify UI; the lead never handles secret values.**
3. **New Dockerfile app `zilar-web`** (`apps/web/Dockerfile`): domain `https://chat.zilar.app`, health check, watch paths `apps/web/**` and `packages/**`.
4. **ejabberd's `/xmpp-ws` and `/upload` are routed by Traefik straight to ejabberd** (a domain-path entry on the ejabberd service), so web deploys never cut chat sockets.
5. **Cutover: one planned short outage** (about 2 min), at a time Julio picks. Afterwards each server or web deploy is a rolling update with no 502.

### To verify before the cutover (a spike task, on a scratch Coolify app, not production)
- Traefik path routing: `/api` on one app and `/` on another, same host; check priorities.
- ejabberd accepting two XEP-0114 connections for `push.<domain>` during the overlap; xmpp.js reconnects on its own (`apps/server/src/push/component.ts:69-72`).
- A Dockerfile app mounting an existing named volume from the compose app.
- In-memory state that's lost on restart today (rate limits, the drafts hub, OTP state) behaves the same after the split: nothing new is lost.

## Spike results (2026-10-13, throwaway project `zdt-spike`, domain `zdt.152.53.146.96.sslip.io`)
- **Path routing works across apps on one host.** App `zdt-web` on `/` and app `zdt-api` on `/api` each answered their own path. **Coolify strips the path prefix by default** (`/api/x` reached the container as `/x`), so the server app must turn strip-prefix off, because it serves `/api/...`.
- **Coolify runs the health check inside the container with curl or wget.** An image with neither (`traefik/whoami`) never turned healthy, and Coolify kept the old container. The server and web images need `wget` or `curl` (check the Dockerfiles).
- **Rolling update under load:** a forced redeploy of `zdt-api` while sending about 4 requests/s for 75 s gave **288 × 200 and 1 failure**, at the second the old container was stopped. The test image exits at once on SIGTERM.
  - **Fix:** on SIGTERM the server keeps serving for about 5 s (it reports unhealthy, so Traefik drops it, and keeps finishing requests), then closes. Caddy (web) gets the same via `grace_period`.
  - The clients' retry on a network error (T-1304 for auth; check the other GETs) covers what's left.
  - Re-run this test with the drain in place before the cutover.

## Split rehearsal (2026-10-18)

Julio approved it. It ran in the throwaway project `zdt-rehearsal` on `zdt.152.53.146.96.sslip.io`, with throwaway secrets, and was deleted afterwards (0 containers and 0 volumes left).
- **The setup:**
  - `zilar-core` from `deploy/coolify/zilar-core.yml`, without the desk services;
  - `zilar-server` and `zilar-web` as Docker-image apps (`ghcr.io/julioferrero/*:latest`, commit `35c1805`).
- **The 10-13 spike's echo apps were still running on that host,** in project `zdt-spike`; they are deleted now.

### Results
- **Server rolling deploy under load** (about 6 requests/s, 390 requests): 0 failed API requests; `/api/me` 130 × 401 and `/` 130 × 200.
  - The only non-200s were 3 × `/health` → 503 from the old copy while it drained, which is what the drain is designed to do.
  - Coolify's log showed "Rolling update started", then "New container is healthy", then "Rolling update completed".
- **The leader lock hands over cleanly:** the new copy logged "listening", then took the lock about 14 s later, only after the old copy stopped. Only one copy ran the leader-only work at any time.
- **Web rolling deploy under load** (231 requests): all succeeded.
- **Routes:**
  - `/` → web;
  - `/health` and `/api/*` → server, unchanged;
  - `/xmpp-ws/ws` → ejabberd (101 over HTTP/1.1).

### Must fix before the cutover
1. **`postgres` on the `coolify` network is Coolify's own database:** `coolify-db` carries the alias `postgres`.
   - `zilar-core` needs "Connect to predefined network", so ejabberd's default `SQL_SERVER: postgres` (`deploy/ejabberd/ejabberd.yml:31`) reached Coolify's database. The login failed, and ejabberd was down.
   - **Fix:** in `deploy/coolify/zilar-core.yml`, set `EJABBERD_MACRO_SQL_SERVER` to the core's unique name `postgres-<core uuid>`, or rename the services (for example `zilar-postgres`). With that, the rehearsal's ejabberd turned `ok`.
   - **Production today is not affected:** its containers are only on their own network, where `postgres` resolves to Zilar's database.
2. **Strip prefix can't be turned off through the API** for an app: the Coolify MCP drops `is_stripprefix_enabled`.
   - The rehearsal used `custom_labels` (base64) without the stripprefix middleware, and `/api/...` arrived unchanged.
   - At the cutover, either untick "Strip Prefixes" in the UI or keep the custom labels.
3. **An app can't mount an existing named volume:**
   - Coolify prefixes app storage with the app uuid (`<app uuid>-<name>`), and a `-v` in `custom_docker_run_options` was ignored.
   - The core's `sticker-data` and `avatar-data` are never created, because no core service uses them.
   - **Plan:** the cutover copies the live `qccydpow4rw0zcel9yisk44s_sticker-data` and `_avatar-data` into the server app's new volumes (`docker run --rm -v src:/a -v dst:/b alpine cp -a /a/. /b/`). The `desk-socket` sharing needs the same answer.
4. **`/upload` breaks under the Service's strip prefix:** strip prefix is one flag per Service component, not per path. `/upload/x` arrived stripped and returned 404.
   - **Fix:** custom labels on the ejabberd component: `/xmpp-ws` stripped, `/upload` not.
5. **`/xmpp-ws` as a prefix exposes ejabberd's admin API path:** `/xmpp-ws/api/status` returned 403, from ejabberd's own permissions.
   - **Fix:** the route matches only `Path(/xmpp-ws/ws)`, same custom labels as item 4.
6. **To check:** `/health` reported `ejabberdSchema: "drift"` on the fresh database. The cutover restores live data, so check this right after the restore.
7. **Health check:** Coolify's check logged `curl: not found` but still returned 0. Make sure the readiness check really runs (`wget` or a `node` probe) and is not passing by accident.

## Not in this plan
Blue-green for postgres or ejabberd themselves: they now restart only when their own image or config changes, which is rare and can be scheduled.
