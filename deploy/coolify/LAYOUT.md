# Zilar on Coolify: the target layout

The definition of the three Coolify resources Zilar runs as after the split
(`docs/deploy/zero-downtime-plan.md` Phase 2, and the installer's step 3 in
`docs/deploy/one-line-install-plan.md`). The installer creates exactly this and
the cutover (plan step 8) follows it. `deploy/coolify/zilar-core.yml` is the
Compose source of `zilar-core`; the other two are Docker-image Applications.
Nothing here touches live, and no values appear here — only names.

**Why three resources:** Coolify does rolling updates for Image/Dockerfile
Applications but never for a Docker Compose stack (`docs/deploy/zero-downtime-plan.md`).
Splitting the stack, so a server or web push restarts only that one container,
is what buys the zero-downtime deploy; keeping postgres, ejabberd and the desks
in one Service keeps their data and network untouched.

## The three resources

| Resource       | Kind                                                       | Image                                                        | Route                                       | Internal port   | Strip prefix                                      | Health check                       |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------- | --------------- | ------------------------------------------------- | ---------------------------------- |
| `zilar-core`   | Service (Docker Compose = `deploy/coolify/zilar-core.yml`) | `ghcr.io/<owner>/zilar-{postgres,ejabberd,desk-agent}:<tag>` | `/xmpp-ws/ws`, `/upload/` on `ZILAR_DOMAIN` | 5280 (ejabberd) | labels: `/xmpp-ws` on, `/upload/` off (see below) | per component, in the Compose file |
| `zilar-server` | Application, Image                                         | `ghcr.io/<owner>/zilar-server:<tag>`                         | `/api`, `/health` on `ZILAR_DOMAIN`         | 3000            | **off**, via custom labels                        | `GET /health` on 3000              |
| `zilar-web`    | Application, Image                                         | `ghcr.io/<owner>/zilar-web:<tag>`                            | `/` on `ZILAR_DOMAIN`                       | 80              | n/a                                               | `GET /` on 80                      |

`<owner>`/`<tag>` are `IMAGE_OWNER`/`IMAGE_TAG` (defaults `julioferrero`,
`latest`). All three read the same `ZILAR_DOMAIN`; it is the host in
`EJABBERD_MACRO_HOST`, `XMPP_DOMAIN` and the App domains, so there is still
exactly one public host.

### zilar-core

- **Source:** the Coolify **Service** created from `deploy/coolify/zilar-core.yml`
  (Docker Compose). Components: `postgres`, `ejabberd`, `desk-agent` and
  `desk-egress`.
- **Domain:** the routes come from the Traefik labels on the `ejabberd`
  component in `zilar-core.yml`, not from a `SERVICE_URL_*` variable, so the
  component has **no Domains entry** and nothing to fix after parsing:
  `zilar-xmpp-ws` routes the exact path `/xmpp-ws/ws` (stripped to `/ws` by
  the `zilar-xmpp-strip` middleware) and `zilar-upload` routes `/upload/`
  with no stripping. Two `http` routers redirect both paths to https.
  Because the WebSocket rule is an exact `Path`, no other `/xmpp-ws/*` path
  is routed (ejabberd's admin API at `/api` stays private).
- **Reaches:** its own components by Compose service name (`postgres`,
  `ejabberd`). ejabberd's SQL host is `CORE_POSTGRES_HOST`: on Coolify's
  shared `coolify` network the name `postgres` is an alias of Coolify's own
  database, so ejabberd must dial `postgres-<core uuid>` instead.
- **Reached by:** `zilar-server` (and `zilar-web`, if it ever needs them) as
  `postgres-<core uuid>` and `ejabberd-<core uuid>` — the container names
  Coolify gives a Service component — with **Connect to predefined network**
  on. It must be on before `zilar-server` starts.
- **Volumes:** `postgres-data`, `ejabberd-database`, `ejabberd-uploads`,
  `desk-socket` (external, named by `SERVER_DESK_SOCKET_VOLUME`) and
  `desk-egress-socket`. `sticker-data` and `avatar-data` are **not** declared
  here: an App cannot mount a Service's named volume, so they are the
  `zilar-server` App's own persistent storages (see below).
- **stop_grace_period:** `ejabberd` 20s (in the Compose file). The other
  components are single-process and exit at once.
- **Desks:** `desk-agent` and `desk-egress` run in this Service always and stay
  idle until the host has gVisor; prepare the host once with
  `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host`.

### zilar-server

- **Image:** `ghcr.io/<owner>/zilar-server:<tag>`, internal port **3000**.
- **Domain and path:** `https://ZILAR_DOMAIN/api` and `/health`, **strip prefix
  off** (the app serves `/api/...`; the spike showed Coolify strips by default,
  and its API cannot turn that off). The App's `custom_labels` therefore carry
  the routers themselves, without a `stripprefix` middleware; the rehearsal
  used this list and `/api/...` arrived unchanged:

  ```yaml
  traefik.enable: 'true'
  traefik.docker.network: coolify
  traefik.http.services.zilar-server.loadbalancer.server.port: '3000'
  traefik.http.middlewares.zilar-gzip.compress: 'true'
  traefik.http.middlewares.zilar-https-redirect.redirectscheme.scheme: https
  traefik.http.routers.zilar-server-api.rule: Host(`ZILAR_DOMAIN`) && PathPrefix(`/api`)
  traefik.http.routers.zilar-server-api.entrypoints: https
  traefik.http.routers.zilar-server-api.tls: 'true'
  traefik.http.routers.zilar-server-api.tls.certresolver: letsencrypt
  traefik.http.routers.zilar-server-api.middlewares: zilar-gzip
  traefik.http.routers.zilar-server-health.rule: Host(`ZILAR_DOMAIN`) && Path(`/health`)
  traefik.http.routers.zilar-server-health.entrypoints: https
  traefik.http.routers.zilar-server-health.tls: 'true'
  traefik.http.routers.zilar-server-health.tls.certresolver: letsencrypt
  traefik.http.routers.zilar-server-health.middlewares: zilar-gzip
  traefik.http.routers.zilar-server-api-http.rule: Host(`ZILAR_DOMAIN`) && PathPrefix(`/api`)
  traefik.http.routers.zilar-server-api-http.entrypoints: http
  traefik.http.routers.zilar-server-api-http.middlewares: zilar-https-redirect
  traefik.http.routers.zilar-server-health-http.rule: Host(`ZILAR_DOMAIN`) && Path(`/health`)
  traefik.http.routers.zilar-server-health-http.entrypoints: http
  traefik.http.routers.zilar-server-health-http.middlewares: zilar-https-redirect
  ```

- **Health check:** Coolify runs it inside the container, so
  `wget -qO- http://127.0.0.1:3000/health` (the image is `node:alpine`, so
  busybox `wget` is present; the Dockerfile's own `HEALTHCHECK` uses `node`).
- **Volumes:** three persistent storages created on the App itself, not named
  volumes from the core: `sticker-data` → `/data/stickers`, `avatar-data` →
  `/data/avatars`, and `desk-socket` → `/run/zilar` (the server reaches
  `desk-agent` at the fixed `/run/zilar/desk.sock`). Coolify names an App's
  storage `<app uuid>-<name>`, so the third is the volume the core mounts as
  `SERVER_DESK_SOCKET_VOLUME`. A `-v` in the App's custom Docker run options
  is ignored: the storage has to be created in the App.
- **Reaches:** `postgres-<core uuid>` and `ejabberd-<core uuid>`
  (`DATABASE_URL`, `XMPP_ARCHIVE_DATABASE_URL`, `EJABBERD_API_URL`,
  `PUSH_COMPONENT_HOST`), with **Connect to predefined network** on.
- **stop_grace_period:** 20s, so the old container drains its in-flight
  requests (zero-downtime plan, spike fix) instead of cutting them.
- **Deploys:** How a deploy is triggered is not decided yet (no Coolify key in
  GitHub). The App has no watch paths — nothing builds on the server.

### zilar-web

- **Image:** `ghcr.io/<owner>/zilar-web:<tag>`, internal port **80**.
- **Domain and path:** `https://ZILAR_DOMAIN/` (path `/`; strip prefix does not
  matter). Traefik's longest path wins, so `/api`, `/xmpp-ws/ws` and `/upload/`
  still reach the server and ejabberd, not this app.
- **Health check:** `wget --no-verbose --tries=1 --spider http://127.0.0.1/`
  inside the container (the image is `caddy:alpine`, so `wget` is present).
- **Volumes:** none.
- **Environment:** none. The Caddy config is baked into the image and its
  public host comes from the App domain, so unlike the old `SERVICE_URL_WEB_80`
  there is nothing to set.
- **Reaches:** nobody once Traefik routes `/api`, `/xmpp-ws/ws` and `/upload/`
  itself (see "The web app and its Caddy").
- **stop_grace_period:** about 20s, for the same drain reason.
- **Deploys:** How a deploy is triggered is not decided yet (no Coolify key in
  GitHub); like `zilar-server` it has no watch paths.

## Order of creation

1. Create the `zilar-server` App with its **3 persistent storages** and deploy
   it once. It turns unhealthy without a database, but the storages now exist
   under their `<app uuid>-<name>` names.
2. Create `zilar-core` from `deploy/coolify/zilar-core.yml` with
   `CORE_POSTGRES_HOST` and `SERVER_DESK_SOCKET_VOLUME` set and **Connect to
   predefined network** on, then deploy it.
3. Redeploy `zilar-server`: it now reaches the core's postgres and becomes
   healthy.
4. Create and deploy `zilar-web`.

On the live host, stop and remove the old compose app (which owns `desk-net`)
before `zilar-core` starts: the network has a fixed name and cannot be adopted
twice.

## Routing (Traefik)

| Public path   | Reaches                     | Strip prefix | Why                                                                                                                  |
| ------------- | --------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `/`           | `zilar-web:80`              | n/a          | static build and SPA fallback                                                                                        |
| `/api`        | `zilar-server:3000`         | **off**      | the server serves `/api/...`                                                                                         |
| `/xmpp-ws/ws` | `ejabberd-<core uuid>:5280` | **on**       | ejabberd answers `/ws` (`request_handlers` in `deploy/ejabberd/ejabberd.yml`), so `/xmpp-ws/ws` must arrive as `/ws` |
| `/upload/`    | `ejabberd-<core uuid>:5280` | **off**      | `mod_http_upload` serves `/upload/...` as written                                                                    |
| `/health`     | `zilar-server:3000`         | **off**      | the installer routes its install/uptime check to the server                                                          |

The paths `/api`, `/xmpp-ws/ws` and `/upload/` are exact enough for the apps
behind them because they existed the same way in `apps/web/Caddyfile`. The
WebSocket router is an exact `Path`, so every other `/xmpp-ws/*` request has no
route (404), as the Caddy file did.

## Variables

Every environment variable the three resources read, by name (never a value),
with which resource needs it and where its value comes from:

- **generated** — the installer creates a random value once and sets the same
  value wherever the row says;
- **user-given** — from the installer's questions (the domain, and the
  optional features the user turns on);
- **derived** — computed from `ZILAR_DOMAIN` or from a generated secret, never
  asked for;
- **fixed** — a constant the layout sets, not user input;
- **optional** — has a working default; the installer sets it only when the
  user asks for that feature.

The installer generates nine secret values once, and sets each wherever the
table says: `POSTGRES_PASSWORD`, `ZILAR_DB_PASSWORD`, `EJABBERD_DB_PASSWORD`,
`ARCHIVE_DB_PASSWORD`, `EJABBERD_ADMIN_PASSWORD`, `XMPP_JWT_SECRET`,
`PUSH_COMPONENT_SECRET`, `BETTER_AUTH_SECRET`, `ZILAR_KEY_ENCRYPTION_KEY`. Two
carry a different name on the resource: `ARCHIVE_DB_PASSWORD` is
`ZILAR_ARCHIVE_DB_PASSWORD` on postgres, and `XMPP_JWT_SECRET` is
`ZILAR_XMPP_JWT_SECRET` on ejabberd and the server.

| Variable                               | Needed by                                                                  | Source                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `IMAGE_OWNER`                          | zilar-core, zilar-server, zilar-web                                        | user-given (optional, default `julioferrero`)                                                                  |
| `IMAGE_TAG`                            | zilar-core, zilar-server, zilar-web                                        | user-given (optional, default `latest`; pin a release)                                                         |
| `ZILAR_DOMAIN`                         | zilar-core (ejabberd); the server's and web's domain values derive from it | user-given                                                                                                     |
| `POSTGRES_USER`                        | zilar-core (postgres)                                                      | fixed                                                                                                          |
| `POSTGRES_DB`                          | zilar-core (postgres)                                                      | fixed                                                                                                          |
| `POSTGRES_PASSWORD`                    | zilar-core (postgres)                                                      | generated                                                                                                      |
| `ZILAR_DB_PASSWORD`                    | zilar-core (postgres); zilar-server (`DATABASE_URL`)                       | generated                                                                                                      |
| `EJABBERD_DB_PASSWORD`                 | zilar-core (postgres, ejabberd)                                            | generated                                                                                                      |
| `ZILAR_ARCHIVE_DB_PASSWORD`            | zilar-core (postgres)                                                      | generated (installer's `ARCHIVE_DB_PASSWORD`; the server embeds the same value in `XMPP_ARCHIVE_DATABASE_URL`) |
| `EJABBERD_MACRO_HOST`                  | zilar-core (ejabberd)                                                      | derived from `ZILAR_DOMAIN`                                                                                    |
| `EJABBERD_MACRO_MUC_HOST`              | zilar-core (ejabberd)                                                      | derived (`rooms.ZILAR_DOMAIN`)                                                                                 |
| `EJABBERD_MACRO_ADMIN`                 | zilar-core (ejabberd)                                                      | derived (`admin@ZILAR_DOMAIN`)                                                                                 |
| `EJABBERD_MACRO_SQL_PASSWORD`          | zilar-core (ejabberd)                                                      | generated (same value as `EJABBERD_DB_PASSWORD`)                                                               |
| `EJABBERD_MACRO_SQL_SERVER`            | zilar-core (ejabberd)                                                      | derived (same value as `CORE_POSTGRES_HOST`; ejabberd's config defaults it to `postgres`)                      |
| `CORE_POSTGRES_HOST`                   | zilar-core (ejabberd)                                                      | derived (`postgres-<core uuid>`)                                                                               |
| `EJABBERD_MACRO_PUSH_COMPONENT_SECRET` | zilar-core (ejabberd)                                                      | generated (same value as `PUSH_COMPONENT_SECRET`)                                                              |
| `EJABBERD_MACRO_UPLOAD_URL`            | zilar-core (ejabberd)                                                      | derived (`https://ZILAR_DOMAIN/upload`)                                                                        |
| `EJABBERD_ADMIN_PASSWORD`              | zilar-core (ejabberd), zilar-server                                        | generated                                                                                                      |
| `ZILAR_XMPP_JWT_SECRET`                | zilar-core (ejabberd), zilar-server                                        | generated (installer's `XMPP_JWT_SECRET`)                                                                      |
| `DESK_RUNTIME`                         | zilar-core (desk-agent)                                                    | user-given (optional, default `runsc`)                                                                         |
| `DESK_MAX_RUNNING`                     | zilar-core (desk-agent)                                                    | user-given (optional, default `12`)                                                                            |
| `DESK_IMAGE_OWNER`                     | zilar-core (desk-agent)                                                    | fixed (derived from `IMAGE_OWNER`, default `julioferrero`)                                                     |
| `DESK_IMAGE_TAG`                       | zilar-core (desk-agent)                                                    | fixed (derived from `IMAGE_TAG`, default `latest`)                                                             |
| `DESK_IMAGE`                           | zilar-core (desk-agent), zilar-server                                      | user-given (optional override: a jail image pinned by digest; empty follows the release)                       |
| `SERVER_DESK_SOCKET_VOLUME`            | zilar-core (desk-agent)                                                    | derived (`<server app uuid>-desk-socket`, the server App's storage volume)                                     |
| `DESK_AGENT_SOCKET`                    | zilar-core (desk-agent), zilar-server                                      | fixed `/run/zilar/desk.sock`                                                                                   |
| `DESK_NETWORK`                         | zilar-core (desk-agent)                                                    | fixed `desk-net`                                                                                               |
| `DESK_CGROUP_PARENT`                   | zilar-core (desk-agent)                                                    | fixed `zilar-desks.slice`                                                                                      |
| `DESK_WORKSPACE_ROOT`                  | zilar-core (desk-agent)                                                    | fixed `/var/lib/zilar/desks`                                                                                   |
| `DESK_WORKSPACE_MODE`                  | zilar-core (desk-agent)                                                    | fixed `image`                                                                                                  |
| `DESK_EGRESS_PROXY`                    | zilar-core (desk-agent)                                                    | fixed `http://desk-egress:3128`                                                                                |
| `DESK_EGRESS_REGISTRY`                 | zilar-core (desk-agent, desk-egress)                                       | fixed `/run/zilar-egress/desk-egress.sock`                                                                     |
| `DESK_EGRESS_PORT`                     | zilar-core (desk-egress)                                                   | fixed `3128`                                                                                                   |
| `NODE_ENV`                             | zilar-server                                                               | optional (default `production`)                                                                                |
| `PORT`                                 | zilar-server                                                               | fixed `3000`                                                                                                   |
| `LOG_LEVEL`                            | zilar-server                                                               | optional (default `info`)                                                                                      |
| `DATABASE_URL`                         | zilar-server                                                               | derived (`postgres://zilar:ZILAR_DB_PASSWORD@postgres-<core uuid>:5432/zilar`)                                 |
| `XMPP_ARCHIVE_DATABASE_URL`            | zilar-server                                                               | derived (`postgres://zilar_archive:ARCHIVE_DB_PASSWORD@postgres-<core uuid>:5432/ejabberd`)                    |
| `PUBLIC_URL`                           | zilar-server                                                               | derived (`https://ZILAR_DOMAIN`)                                                                               |
| `WEB_ORIGINS`                          | zilar-server                                                               | derived (`https://ZILAR_DOMAIN`)                                                                               |
| `TRUSTED_PROXY_HOPS`                   | zilar-server                                                               | fixed `1` (Traefik routes `/api` straight to zilar-server, so only Traefik appends `X-Forwarded-For`)          |
| `BETTER_AUTH_SECRET`                   | zilar-server                                                               | generated                                                                                                      |
| `ZILAR_KEY_ENCRYPTION_KEY`             | zilar-server                                                               | generated                                                                                                      |
| `EJABBERD_API_URL`                     | zilar-server                                                               | derived (`http://ejabberd-<core uuid>:5280/api`)                                                               |
| `EJABBERD_ADMIN_JID`                   | zilar-server                                                               | derived (`admin@ZILAR_DOMAIN`)                                                                                 |
| `XMPP_DOMAIN`                          | zilar-server                                                               | derived (`ZILAR_DOMAIN`)                                                                                       |
| `XMPP_MUC_DOMAIN`                      | zilar-server                                                               | derived (`rooms.ZILAR_DOMAIN`)                                                                                 |
| `XMPP_WS_PUBLIC_URL`                   | zilar-server                                                               | derived (`wss://ZILAR_DOMAIN/xmpp-ws/ws`)                                                                      |
| `PUSH_COMPONENT_JID`                   | zilar-server                                                               | derived (`push.ZILAR_DOMAIN`)                                                                                  |
| `PUSH_COMPONENT_SECRET`                | zilar-server                                                               | generated                                                                                                      |
| `PUSH_COMPONENT_HOST`                  | zilar-server                                                               | derived (`ejabberd-<core uuid>`)                                                                               |
| `STICKER_STORAGE_DIR`                  | zilar-server                                                               | fixed `/data/stickers`                                                                                         |
| `AVATAR_STORAGE_DIR`                   | zilar-server                                                               | fixed `/data/avatars`                                                                                          |
| `BACKGROUND_STORAGE_DIR`               | zilar-server                                                               | fixed `/data/avatars/backgrounds`                                                                              |
| `CARD_MEDIA_STORAGE_DIR`               | zilar-server                                                               | fixed `/data/avatars/card-media`                                                                               |
| `AGENT_GATEWAY_ENABLED`                | zilar-server                                                               | optional (default `true`)                                                                                      |
| `ACTION_DEMO_ENABLED`                  | zilar-server                                                               | optional (default `false`)                                                                                     |
| `RUNNER_HUB_ENABLED`                   | zilar-server                                                               | optional (default `false`)                                                                                     |
| `RUNNER_HUB_PORT`                      | zilar-server                                                               | fixed `3189`                                                                                                   |
| `SMTP_HOST`                            | zilar-server                                                               | optional (empty = unset)                                                                                       |
| `SMTP_PORT`                            | zilar-server                                                               | optional (default `587`)                                                                                       |
| `SMTP_SECURE`                          | zilar-server                                                               | optional (default `false`)                                                                                     |
| `SMTP_USER`                            | zilar-server                                                               | optional                                                                                                       |
| `SMTP_PASSWORD`                        | zilar-server                                                               | optional                                                                                                       |
| `MAIL_FROM`                            | zilar-server                                                               | optional                                                                                                       |
| `MAIL_REPLY_TO`                        | zilar-server                                                               | optional                                                                                                       |
| `PUSH_ENABLED`                         | zilar-server                                                               | optional (default `false`)                                                                                     |
| `PUSH_VAPID_PUBLIC_KEY`                | zilar-server                                                               | optional                                                                                                       |
| `PUSH_VAPID_PRIVATE_KEY`               | zilar-server                                                               | optional                                                                                                       |
| `PUSH_VAPID_SUBJECT`                   | zilar-server                                                               | optional                                                                                                       |
| `PUSH_STORAGE_KEY`                     | zilar-server                                                               | optional                                                                                                       |
| `FCM_SERVICE_ACCOUNT_JSON`             | zilar-server                                                               | optional                                                                                                       |
| `FCM_PROJECT_ID`                       | zilar-server                                                               | optional                                                                                                       |
| `TOOLS_ENABLED`                        | zilar-server                                                               | optional (default `true`)                                                                                      |
| `ROUTINES_ENABLED`                     | zilar-server                                                               | optional (default `true`)                                                                                      |
| `WEB_TOOLS_ENABLED`                    | zilar-server                                                               | optional (default `true`)                                                                                      |

`zilar-web` reads no variable. The old `SERVICE_URL_WEB_80: /` is not needed:
the web App's domain comes from its Coolify domain setting.

## The web app and its Caddy

Before the split, one domain went to `web`, and `apps/web/Caddyfile` was the
single entry point: it forwarded `/api` and `/health` to the server, and
`/xmpp-ws/ws` (404 for every other `/xmpp-ws/*`, to keep ejabberd's admin REST
API private) and `/upload/*` to ejabberd.

After the split, Traefik sends `/api`, `/xmpp-ws/ws` and `/upload/` straight to
`zilar-server` and `ejabberd`, so the web container only ever serves `/`,
`/assets/*`, `/install.sh` and the SPA fallback. The forwarding blocks in
`apps/web/Caddyfile` become unreachable — and would **502** if they were ever
reached, because `server` and `ejabberd` are not DNS names on the web App's
network. **`apps/web/Caddyfile` needs no change for the split** (not made in
this task): the same blocks still serve the live Compose app and
`deploy/docker-compose.yml`, and they are harmless once Traefik routes the
paths itself. The installer also routes `/health` to `zilar-server` (the App's
create body carries `/api` and `/health`), so the install's
`https://ZILAR_DOMAIN/health` wait reaches the server rather than the web App
(see the table above).

## Rehearsal findings (2026-10-18, plan step 7)

The lead rehearsed this layout on a throwaway Coolify 4.4.6 project. Rolling
deploys of `zilar-server` and `zilar-web` lost **0 API requests**. What the
rehearsal settled:

1. **Strip prefix is per component, not per path.** With one
   `SERVICE_URL_*` path plus `/upload` added in the Domains field, both paths
   shared the component's strip flag: `/upload/...` arrived stripped and
   404'd. The fix is explicit labels with one router per path, as in
   `zilar-core.yml`.
2. **The WebSocket.** `/xmpp-ws/ws` upgraded fine (101) through the strip
   middleware. The router is an exact `Path`, so no other `/xmpp-ws/*` request
   is routed (404).
3. **The admin API.** Under the prefix route `/xmpp-ws/api/status` reached
   ejabberd's admin API (403 from ejabberd's own permissions). It must not be
   reachable at all; the exact `Path` rule above does that.
4. **Volumes.** An App cannot mount a Service's named volume, and a `-v` in
   the App's custom Docker run options is ignored: an App's storage is
   `<app uuid>-<name>`. So `sticker-data` and `avatar-data` are the server
   App's storages, and `desk-socket` is declared `external` in the core with
   `SERVER_DESK_SOCKET_VOLUME` naming that App's storage volume.
5. **The name clash.** On the shared `coolify` network `postgres` is an alias
   of Coolify's own database (`coolify-db`), so ejabberd's default SQL host
   failed. `CORE_POSTGRES_HOST=postgres-<core uuid>` fixed it (`/health`
   showed `ejabberd: ok`).
6. **Cross-resource DNS and the server's strip prefix.** `zilar-server`
   resolved `postgres-<core uuid>` and `ejabberd-<core uuid>`. Its strip
   prefix cannot be turned off through Coolify's API, so the App's
   `custom_labels` carry the routers above; `/api/...` arrived unchanged.
7. **Desks.** gVisor is installed in production and 2 jails run: the
   `desk-agent`/`desk-egress` pair and the `desk-net` network are live
   concerns, not optional.

### Still open

- **Re-rehearse these files.** The label sets, the external `desk-socket` and
  the order of creation above are written from the rehearsal but have not
  been rehearsed as written.
- **`ejabberdSchema: "drift"` on a fresh database.** Check `GET /health`
  after the cutover: a fresh postgres should report `"ejabberdSchema":"ok"`;
  `drift` means the archive tables do not match the committed list.
