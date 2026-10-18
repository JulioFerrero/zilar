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

| Resource       | Kind                                                       | Image                                                        | Route                                   | Internal port   | Strip prefix                                   | Health check                       |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------- | --------------- | ---------------------------------------------- | ---------------------------------- |
| `zilar-core`   | Service (Docker Compose = `deploy/coolify/zilar-core.yml`) | `ghcr.io/<owner>/zilar-{postgres,ejabberd,desk-agent}:<tag>` | `/xmpp-ws`, `/upload` on `ZILAR_DOMAIN` | 5280 (ejabberd) | `/xmpp-ws` on, `/upload` off (see "To verify") | per component, in the Compose file |
| `zilar-server` | Application, Image                                         | `ghcr.io/<owner>/zilar-server:<tag>`                         | `/api` on `ZILAR_DOMAIN`                | 3000            | **off** (`/api/...` must reach the app)        | `GET /health` on 3000              |
| `zilar-web`    | Application, Image                                         | `ghcr.io/<owner>/zilar-web:<tag>`                            | `/` on `ZILAR_DOMAIN`                   | 80              | n/a                                            | `GET /` on 80                      |

`<owner>`/`<tag>` are `IMAGE_OWNER`/`IMAGE_TAG` (defaults `julioferrero`,
`latest`). All three read the same `ZILAR_DOMAIN`; it is the host in
`EJABBERD_MACRO_HOST`, `XMPP_DOMAIN` and the App domains, so there is still
exactly one public host.

### zilar-core

- **Source:** the Coolify **Service** created from `deploy/coolify/zilar-core.yml`
  (Docker Compose). Components: `postgres`, `ejabberd`, `desk-agent` and
  `desk-egress`.
- **Domain:** the generated domain is on the `ejabberd` component, port 5280,
  path `/xmpp-ws`. The second path `/upload` is added to the same component's
  **Domains** field after parsing (Coolify documents one path suffix per
  `SERVICE_URL_*` variable, and the Domains field as the way to change a
  component's domains). Both are unverified — see the last section.
- **Reaches:** its own components by Compose service name (`postgres`,
  `ejabberd`).
- **Reached by:** `zilar-server` (and `zilar-web`, if it ever needs them) as
  `postgres-<core uuid>` and `ejabberd-<core uuid>` — the container names
  Coolify gives a Service component — with **Connect to predefined network**
  on. It must be on before `zilar-server` starts.
- **Volumes:** `postgres-data`, `ejabberd-database`, `ejabberd-uploads`,
  `sticker-data`, `avatar-data`, `desk-socket`, `desk-egress-socket`. The last
  four are declared here so the live data keeps its name across the cutover;
  `sticker-data` and `avatar-data` are mounted by `zilar-server`, not by a
  service in this file (see the volume note under "To verify").
- **stop_grace_period:** `ejabberd` 20s (in the Compose file). The other
  components are single-process and exit at once.
- **Desks:** `desk-agent` and `desk-egress` run in this Service always and stay
  idle until the host has gVisor; prepare the host once with
  `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host`.

### zilar-server

- **Image:** `ghcr.io/<owner>/zilar-server:<tag>`, internal port **3000**.
- **Domain and path:** `https://ZILAR_DOMAIN/api`, **strip prefix off** (the
  app serves `/api/...`; the spike showed Coolify strips by default and the
  server app must turn it off).
- **Health check:** Coolify runs it inside the container, so
  `wget -qO- http://127.0.0.1:3000/health` (the image is `node:alpine`, so
  busybox `wget` is present; the Dockerfile's own `HEALTHCHECK` uses `node`).
- **Volumes:** mount the named volumes `sticker-data` → `/data/stickers` and
  `avatar-data` → `/data/avatars`; also `desk-socket` → `/run/zilar` (the
  server reaches `desk-agent` at the fixed `/run/zilar/desk.sock`).
- **Reaches:** `postgres-<core uuid>` and `ejabberd-<core uuid>`
  (`DATABASE_URL`, `XMPP_ARCHIVE_DATABASE_URL`, `EJABBERD_API_URL`,
  `PUSH_COMPONENT_HOST`), with **Connect to predefined network** on.
- **stop_grace_period:** 20s, so the old container drains its in-flight
  requests (zero-downtime plan, spike fix) instead of cutting them.
- **Deploys:** CI calls Coolify's `POST /deploy` for this App after it publishes
  a new `zilar-server` image tag (plan, target layout item 5); the App has no
  watch paths — nothing builds on the server.

### zilar-web

- **Image:** `ghcr.io/<owner>/zilar-web:<tag>`, internal port **80**.
- **Domain and path:** `https://ZILAR_DOMAIN/` (path `/`; strip prefix does not
  matter). Traefik's longest path wins, so `/api`, `/xmpp-ws` and `/upload`
  still reach the server and ejabberd, not this app.
- **Health check:** `wget --no-verbose --tries=1 --spider http://127.0.0.1/`
  inside the container (the image is `caddy:alpine`, so `wget` is present).
- **Volumes:** none.
- **Environment:** none. The Caddy config is baked into the image and its
  public host comes from the App domain, so unlike the old `SERVICE_URL_WEB_80`
  there is nothing to set.
- **Reaches:** nobody once Traefik routes `/api`, `/xmpp-ws` and `/upload`
  itself (see "The web app and its Caddy").
- **stop_grace_period:** about 20s, for the same drain reason.
- **Deploys:** CI calls `POST /deploy` for this App after it publishes a new
  `zilar-web` image tag; like `zilar-server` it has no watch paths.

## Routing (Traefik)

| Public path | Reaches                     | Strip prefix | Why                                                                                                                  |
| ----------- | --------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `/`         | `zilar-web:80`              | n/a          | static build and SPA fallback                                                                                        |
| `/api`      | `zilar-server:3000`         | **off**      | the server serves `/api/...`                                                                                         |
| `/xmpp-ws`  | `ejabberd-<core uuid>:5280` | **on**       | ejabberd answers `/ws` (`request_handlers` in `deploy/ejabberd/ejabberd.yml`), so `/xmpp-ws/ws` must arrive as `/ws` |
| `/upload`   | `ejabberd-<core uuid>:5280` | **off**      | `mod_http_upload` serves `/upload/...` as written                                                                    |
| `/health`   | `zilar-server:3000`         | **off**      | the installer routes its install/uptime check to the server                                                          |

The paths `/api`, `/xmpp-ws`, `/upload` are exact enough for the apps behind
them because they existed the same way in `apps/web/Caddyfile`.

## Deploys from CI

`images.yml`'s `deploy` job asks Coolify to pull the new images after a green
CI run on main publishes `:latest`: a `GET /api/v1/deploy?uuid=<app uuid>`
against `COOLIFY_URL`, for `zilar-server` first, then for `zilar-web`. The App
then does a rolling update, so the old container drains while the new one
starts.

The job reads four repository secrets, which Julio sets at the cutover:

| Secret                    | Holds                                                    |
| ------------------------- | -------------------------------------------------------- |
| `COOLIFY_URL`             | the Coolify base URL, e.g. `https://coolify.example.com` |
| `COOLIFY_DEPLOY_TOKEN`    | an API token with Coolify's **deploy** permission only   |
| `COOLIFY_SERVER_APP_UUID` | the `zilar-server` App's UUID                            |
| `COOLIFY_WEB_APP_UUID`    | the `zilar-web` App's UUID                               |

The token needs no other permission: the deploy endpoint is all it calls.
Until all four secrets are set the job prints
`Coolify deploy secrets not set; skipping (see deploy/coolify/LAYOUT.md)` and
succeeds, so green main runs stay green before the cutover.

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
| `EJABBERD_MACRO_PUSH_COMPONENT_SECRET` | zilar-core (ejabberd)                                                      | generated (same value as `PUSH_COMPONENT_SECRET`)                                                              |
| `EJABBERD_MACRO_UPLOAD_URL`            | zilar-core (ejabberd)                                                      | derived (`https://ZILAR_DOMAIN/upload`)                                                                        |
| `EJABBERD_ADMIN_PASSWORD`              | zilar-core (ejabberd), zilar-server                                        | generated                                                                                                      |
| `ZILAR_XMPP_JWT_SECRET`                | zilar-core (ejabberd), zilar-server                                        | generated (installer's `XMPP_JWT_SECRET`)                                                                      |
| `SERVICE_URL_EJABBERD_5280`            | zilar-core (ejabberd)                                                      | fixed path `/xmpp-ws` (Coolify magic variable; the `/upload` path is added in the component's Domains field)   |
| `DESK_RUNTIME`                         | zilar-core (desk-agent)                                                    | user-given (optional, default `runsc`)                                                                         |
| `DESK_MAX_RUNNING`                     | zilar-core (desk-agent)                                                    | user-given (optional, default `12`)                                                                            |
| `DESK_IMAGE_OWNER`                     | zilar-core (desk-agent)                                                    | fixed (derived from `IMAGE_OWNER`, default `julioferrero`)                                                     |
| `DESK_IMAGE_TAG`                       | zilar-core (desk-agent)                                                    | fixed (derived from `IMAGE_TAG`, default `latest`)                                                             |
| `DESK_IMAGE`                           | zilar-core (desk-agent), zilar-server                                      | user-given (optional override: a jail image pinned by digest; empty follows the release)                       |
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

After the split, Traefik sends `/api`, `/xmpp-ws` and `/upload` straight to
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

## To verify in the rehearsal (plan step 7)

1. **Two paths for one Service component.** Coolify documents one path suffix
   per `SERVICE_URL_*` variable; confirm the `/upload` path can be added to the
   `ejabberd` component's **Domains** field next to the `/xmpp-ws` path from
   the Compose file, and survives the next save/parse.
2. **Strip prefix, per path.** `/xmpp-ws/ws` must arrive at ejabberd as `/ws`
   (strip on) and `/upload/...` must arrive unchanged (strip off). Confirm the
   two paths can carry opposite strip settings. If a Service cannot, the
   fallback is to keep `/upload` proxied by the web App's Caddy (its
   `/upload/*` block already forwards to ejabberd without stripping).
3. **The /xmpp-ws admin API.** `apps/web/Caddyfile` answers 404 for every
   `/xmpp-ws/*` path except `/xmpp-ws/ws`, because ejabberd's `mod_http_api`
   lives at `/api` on the same 5280 listener (SEC-2). Routing the prefix
   `/xmpp-ws` to ejabberd would expose `/xmpp-ws/api/...` as `/api/...`. Check
   that `/xmpp-ws/api` is not reachable after the cutover; if it is, tighten
   the route or keep the WebSocket proxied by the web App's Caddy.
4. **Cross-resource volumes.** Confirm `zilar-server` can mount the core
   Service's `sticker-data` and `avatar-data` (a Dockerfile App mounting an
   existing named volume, per the zero-downtime plan's spike list), and that
   the same trick shares `desk-socket` so the server reaches `desk-agent` when
   desks are on.
5. **Path priorities.** `/` on `zilar-web`, `/api` on `zilar-server` and the
   two ejabberd paths on one host: confirm each path reaches its own app and
   nothing falls through to web.
6. **`/health` after the split** (routing table above): the installer now routes
   it to `zilar-server` (the App's create body carries `/api` and `/health`).
   Confirm the rehearsal reaches the server on both `https://ZILAR_DOMAIN/api/...`
   and `https://ZILAR_DOMAIN/health`.
7. **Container-internal health checks.** The spike showed Coolify checks health
   with `curl`/`wget` inside the container; both images ship `wget`, but confirm
   the health check path/port Coolify runs for each App.
8. **Cross-resource DNS.** `zilar-server` resolves `postgres-<core uuid>` and
   `ejabberd-<core uuid>` after **Connect to predefined network** is on for
   both, and reconnects after a core Service restart.
9. **The server drain.** Re-run the spike's rolling-update test with the 5 s
   SIGTERM drain so the server App's deploy loses no requests.
10. **Desk services run everywhere.** Confirm the core Service starts
    `desk-agent` and `desk-egress` without a profile, that they stay idle (no
    running jails) until the host prep has run, and that computers then turn
    on within about a minute with no redeploy.
11. **Deploys.** CI's `POST /deploy` rebuilds only `zilar-server` or
    `zilar-web` (whichever image it published), and neither restarts
    `zilar-core`.
