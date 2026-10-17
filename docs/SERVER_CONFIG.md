# Zilar server configuration reference

Every environment variable the Zilar server reads, its default and what it does. The server's own
variables are decoded in `apps/server/src/config/server-schema.ts`, `apps/server/src/push/config.ts`
and `apps/server/src/xmpp/config.ts` (loading and cross-field rules in
`apps/server/src/config/load.ts` and `apps/server/src/config/mail.ts`); `apps/server/src/config.ts`
re-exports the loader. Values are placeholders only — a real install keeps them in a git-ignored
`.env`, never in a committed file.

**Secret** in the last column means: never commit, never paste into chat, never echo in a config
error. The config code names the variable but never prints a value back.

## 1. What runs where

The plain install (`deploy/docker-compose.yml`) runs one Postgres, one ejabberd, the server, the web
build and a Caddy reverse proxy (the only service publishing host ports). The Coolify template
(`deploy/coolify/docker-compose.yml`) is the same shape behind Coolify's Traefik. The AI-computer
services run in every stack. The desk agent stays idle until the host has gVisor (`--desks-host`, or
`sudo ./zilar host-setup`), then turns ready on its own; there is no variable to set (T-1602, T-1605).

| Process | What it is | Port(s) | Set by |
|---|---|---|---|
| Zilar server (`@zilar`) | Effect HTTP edge on `node:http` | `PORT`, default `3000` | `apps/server/src/config/server-schema.ts:24`, bound `apps/server/src/startup/components.ts:247-254` |
| Web app | React build served as static files (`web` in Compose; Vite dev server locally) | `80` inside the stack; Vite dev `5173` | `deploy/docker-compose.yml:239-253`, dev proxy `apps/web/vite.config.ts:17` |
| Postgres (`pgvector`) | data store | `5432` (loopback in the dev stack) | `deploy/docker-compose.yml:30-57`, `infra/docker-compose.dev.yml:20-21` |
| ejabberd | XMPP server (C2S, admin API, WebSocket) | `5222` (C2S), `5280` (HTTP/WS/admin) | `deploy/docker-compose.yml:59-98`, `infra/docker-compose.dev.yml:49-53` |
| Caddy | reverse proxy + automatic HTTPS, plain stack only | `HTTP_PORT`/`HTTPS_PORT`, default `80`/`443` | `deploy/docker-compose.yml:255-293` |
| Runner hub (optional) | tunnel for approved AI runners, loopback only | `RUNNER_HUB_PORT`, default `3189` | `apps/server/src/config/server-schema.ts:174`, started `apps/server/src/leader/start.ts:147-167` |
| Push component (optional) | XEP-0114 component for web/native push, no host port | `PUSH_COMPONENT_PORT`, default `5347` | `apps/server/src/push/config.ts:45-68`, started `apps/server/src/leader/start.ts:78-141` |
| `desk-agent` (always; idle until gVisor) | runs the sandboxed desk jails; only holder of the Docker socket | unix socket `/run/zilar/desk.sock` | `deploy/docker-compose.yml:301-343` |
| `desk-egress` (always) | a jail's only route to the web | `3128` (internal) | `deploy/docker-compose.yml:344-373` |

## 2. Every variable

### Core and storage

| Variable | Required | Default | What it does | Secret? |
|---|---|---|---|---|
| `NODE_ENV` | No | `development` | One of `development`/`test`/`production`. Picks the logger, the mail default and the production warnings (`server-schema.ts:23`, `apps/server/src/logger.ts`). | No |
| `PORT` | No | `3000` | TCP port the HTTP edge binds (integer `1`–`65535`; `server-schema.ts:24`). | No |
| `LOG_LEVEL` | No | `info` | One of `fatal`/`error`/`warn`/`info`/`debug`/`trace`, passed to pino (`server-schema.ts:26-29`). | No |
| `PUBLIC_URL` | No | `http://localhost:3000` | Public base URL; used for cookie scoping, the origin allow-list and as the default for `BETTER_AUTH_URL` (`server-schema.ts:30`). | No |
| `WEB_ORIGINS` | No | `http://localhost:5173` | Comma-separated web origins allowed to call the API with cookies; each normalised to its URL origin and deduplicated (`server-schema.ts:33`, `apps/server/src/config/load.ts:108`). Empty fails startup. | No |
| `ZILAR_COMMIT` | No | `unknown` | Build commit reported by `/health`; baked into the image by CI (`apps/server/src/health.ts:86`, `apps/server/Dockerfile:55`). | No |
| `STICKER_STORAGE_DIR` | No | `./data/stickers` | Directory uploaded stickers live in; created and checked writable at startup (`server-schema.ts:50`, `apps/server/src/startup/boot.ts:99-107`). | No |
| `AVATAR_STORAGE_DIR` | No | `./data/avatars` | Directory avatars live in; same rules as stickers (`server-schema.ts:55`, `boot.ts:111-112`). | No |
| `BACKGROUND_STORAGE_DIR` | No | `./data/backgrounds` | Directory uploaded chat backgrounds live in; same rules (`server-schema.ts:60`, `boot.ts:115-116`). | No |
| `CARD_MEDIA_STORAGE_DIR` | No | `./data/card-media` | Directory AI card images and files live in; same rules (`server-schema.ts:64`, `boot.ts:120-121`). | No |

### Database

| Variable | Required | Default | What it does | Secret? |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | — | Postgres connection string (`postgres://`/`postgresql://`) for every Drizzle query and migrations (`server-schema.ts:25`). | **Secret** |
| `XMPP_ARCHIVE_DATABASE_URL` | No | — | Read-only connection to the ejabberd MAM archive; absent means `GET /api/search` answers 501 and push cannot resolve recipients (`server-schema.ts:34-37`). | **Secret** |

### XMPP / ejabberd

| Variable | Required | Default | What it does | Secret? |
|---|---|---|---|---|
| `EJABBERD_API_URL` | No | `http://127.0.0.1:5280/api` | ejabberd admin HTTP API the server calls to create accounts and rooms (`apps/server/src/xmpp/config.ts:35`). Trailing slashes stripped. | No |
| `EJABBERD_ADMIN_JID` | Yes | — | Bare JID (`local@domain`) of the admin account (`xmpp/config.ts:39`). | Semi |
| `EJABBERD_ADMIN_PASSWORD` | Yes | — | Password of that admin account (`xmpp/config.ts:46`). | **Secret** |
| `XMPP_DOMAIN` | No | `zilar.localhost` | XMPP domain users are registered on (lowercase host name; `xmpp/config.ts:47`). | No |
| `XMPP_MUC_DOMAIN` | No | `rooms.zilar.localhost` | MUC (group chat) domain (`xmpp/config.ts:48`). | No |
| `XMPP_WS_PUBLIC_URL` | No | `ws://127.0.0.1:5280/ws` | Public WebSocket URL clients connect to; must be `ws://` or `wss://` (`xmpp/config.ts:49`). | No |
| `ZILAR_XMPP_JWT_SECRET` | Yes | — | HS256 secret for XMPP login JWTs, at least 32 chars; must match the ejabberd container (`xmpp/config.ts:53-59`). | **Secret** |

### Auth and mail

| Variable | Required | Default | What it does | Secret? |
|---|---|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | — | Secret Better Auth signs sessions and encrypts data with, at least 32 chars (`server-schema.ts:31`). | **Secret** |
| `BETTER_AUTH_URL` | No | `PUBLIC_URL` | Base URL Better Auth advertises (`server-schema.ts:32`, default applied `apps/server/src/config/load.ts:110`). | No |
| `WEB_BASE_URL` | No | `http://localhost:5173` | Web base baked into group invite links (`${WEB_BASE_URL}/j/<token>`; `server-schema.ts:46`). | No |
| `TRUSTED_PROXY_HOPS` | No | `0` | Right-most `x-forwarded-for` hops to trust for the per-IP limiters (integer `0`–`5`; `server-schema.ts:76-89`). `0` uses the socket address. | No |
| `MAIL_TRANSPORT` | In production | `console` outside production, unset in production | `console` logs sign-in codes (development only); `smtp` sends through nodemailer. Unset lets first-run setup store a transport (`server-schema.ts:98-104`, `load.ts:109`). | No |
| `SMTP_HOST` | With `smtp` | — | SMTP host (`server-schema.ts:105-106`). | No |
| `SMTP_PORT` | No | `587` | SMTP port (integer `1`–`65535`; `server-schema.ts:107-108`). | No |
| `SMTP_SECURE` | No | `false` | `true` = implicit TLS (usually 465); `false` = STARTTLS required, never plaintext (`server-schema.ts:109-112`). | No |
| `SMTP_USER` | With password | — | SMTP username; set together with `SMTP_PASSWORD` or neither (`server-schema.ts:113-115`, `mail.ts:42-46`). | Semi |
| `SMTP_PASSWORD` | With user | — | SMTP password or API key (`server-schema.ts:113-116`). | **Secret** |
| `MAIL_FROM` | With `smtp` | — | Sender on sign-in mails, e.g. `Zilar <no-reply@example.com>`; validated as a mailbox (`server-schema.ts:117-119`, `mail.ts:39-56`). | No |
| `MAIL_REPLY_TO` | No | — | Optional `Reply-To` header on sign-in mails; validated as a mailbox when set (`server-schema.ts:120-121`, `mail.ts:47-56`). | No |
| `MAIL_ALLOW_CONSOLE_IN_PRODUCTION` | No | `false` | Opt-in that lets a private install use the console mailer in production and logs a loud warning (`server-schema.ts:122-126`). | No |

### AI and keys

| Variable | Required | Default | What it does | Secret? |
|---|---|---|---|---|
| `ZILAR_KEY_ENCRYPTION_KEY` | No | — | Envelope key for provider keys and stored settings, at least 32 chars; absent leaves the server up but AI/connection write routes answer 503 (`server-schema.ts:90-97`). | **Secret** |
| `GITHUB_APP_ID` | No | — | GitHub App id for installation-token JWTs (`server-schema.ts:38-40`). | Semi |
| `GITHUB_APP_PRIVATE_KEY` | No | — | PKCS#8 PEM the proxy signs the App JWT with (`server-schema.ts:41`). | **Secret** |
| `GITHUB_APP_INSTALLATION_ID` | No | — | Installation id the App JWT is exchanged for (`server-schema.ts:42`). All three GitHub values must be set together (`mail.ts:18-30`). | Semi |
| `TELEGRAM_BOT_TOKEN` | No | — | Bot token that may import public Telegram sticker packs; unset disables the route 501 (`server-schema.ts:61-67`). | **Secret** |
| `GIF_PROVIDER` | No | — (off) | Picks the GIF search adapter (`giphy` today); unset disables the GIF routes (`server-schema.ts:68-73`). | No |
| `GIF_API_KEY` | With provider | — | GIF provider API key, never logged or returned (`server-schema.ts:74`). | **Secret** |
| `GIF_RATING` | No | `pg-13` | Provider rating filter `g`/`pg`/`pg-13`/`r` (`server-schema.ts:75`). | No |

### Push

| Variable | Required | Default | What it does | Secret? |
|---|---|---|---|---|
| `PUSH_ENABLED` | No | `false` | `true` starts the XEP-0114 component and the `/api/push/*` routes (`push/config.ts:39`, `leader/start.ts:78-81`). | No |
| `PUSH_VAPID_PUBLIC_KEY` | With push | — | VAPID public key served to logged-in browsers (`push/config.ts:40`). | No |
| `PUSH_VAPID_PRIVATE_KEY` | With push | — | VAPID private key (`push/config.ts:41`). | **Secret** |
| `PUSH_VAPID_SUBJECT` | With push | — | Contact URI for the push services, e.g. `mailto:admin@example.com` (`push/config.ts:42`). | No |
| `PUSH_COMPONENT_JID` | With push | — | Component domain, e.g. `push.<domain>`; must equal the ejabberd listener host (`push/config.ts:43`). | No |
| `PUSH_COMPONENT_SECRET` | With push | — | Shared secret with ejabberd; the shipped placeholder counts as unset (`push/config.ts:44`, `36`, `258-265`). | **Secret** |
| `PUSH_COMPONENT_PORT` | No | `5347` | ejabberd component listener port (integer `1`–`65535`; `push/config.ts:45-53`). | No |
| `PUSH_COMPONENT_HOST` | No | `127.0.0.1` | Host of that listener; Compose sets `ejabberd` (plain hostname only; `push/config.ts:54-68`). | No |
| `PUSH_STORAGE_KEY` | With push | — | Seals subscription keys at rest (AES-256-GCM), at least 32 chars; rotating orphans devices (`push/config.ts:69-73`). | **Secret** |
| `FCM_SERVICE_ACCOUNT_JSON` | No | — | Firebase service-account JSON on one line; empty = native (Android) push off (`push/config.ts:74-78`). | **Secret** |
| `FCM_PROJECT_ID` | No | JSON `project_id` | FCM project id override (`push/config.ts:79`). | No |

Empty `PUSH_*`/`FCM_*` values mean "unset" so Compose's `${VAR:-}` can leave them blank (`push/config.ts:116-129`).

### Feature flags

| Variable | Required | Default | What it does | Secret? |
|---|---|---|---|---|
| `AGENT_GATEWAY_ENABLED` | No | `false` in the server; every install sets `true` (the compose files, `./zilar init`, the `.env` examples; T-1601) | Keeps every active AI online over XMPP and replies to owner DMs and group mentions (`server-schema.ts:127-130`, `agents/gateway/lifecycle.ts:133-140`). | No |
| `ACTION_DEMO_ENABLED` | No | `false` | Registers the harmless `demo.echo` action so the approval flow can be proven end to end (`server-schema.ts:131-135`, `startup/components.ts:134`). | No |
| `RUNNER_HUB_ENABLED` | No | `false` | Starts the runner hub tunnel on `RUNNER_HUB_PORT` bound to `127.0.0.1` (`server-schema.ts:136-139`, `leader/start.ts:147-167`). | No |
| `ROUTINES_ENABLED` | No | `false` in the server; every install sets `true` (T-1613) | Runs the routines scheduler; needs a tool runner (see `TOOLS_ENABLED`) (`server-schema.ts:140-144`, `routines/wiring.ts:40-49`). | No |
| `TOOLS_ENABLED` | No | `false` in the server; every install sets `true` (T-1613) | Builds the sandbox tool runner and registers `tool.*`/`routine.*` adapters (`server-schema.ts:145-151`, `startup/components.ts:119-122`). | No |
| `WEB_TOOLS_ENABLED` | No | `false` in the server; every install sets `true` (T-1613) | Registers the gateway web tools `web.fetch`/`wikipedia`/`price`/`feed`/`search` (`server-schema.ts:152-157`, `startup/components.ts:129-132`). | No |
| `LISTENER_ENABLED` | No | `false` | Group listener switch; currently always off — the server logs and ignores it until AIs pay for their own model calls (`server-schema.ts:158-161`, `startup/components.ts:204-211`). | No |
| `LISTENER_MODEL` | No | — | Model the listener would score with; inert while `LISTENER_ENABLED` is ignored (`server-schema.ts:162-164`). | No |
| `AGENT_TOOL_MAX_ROUNDS` | No | `1` with tools off, `6` with tools on | Tool rounds one AI turn may run (integer `1`–`10`; `server-schema.ts:165-169`, `load.ts:111-117`). | No |
| `WEB_SEARCH_PROVIDER` | No | `duckduckgo-html` | Search backend behind the port; `none` unregisters `web.search` (`server-schema.ts:170-173`). | No |

### AI computers (desks)

| Variable | Required | Default | What it does | Secret? |
|---|---|---|---|---|
| `DESK_AGENT_SOCKET` | No | `/run/zilar/desk.sock` | Socket of the desk agent. The server asks it for `status` (cached ~10 s) and offers Zilar cloud computers only while the agent answers ready (T-1603, `hands/desk-status.ts`). | No |
| `DESK_IMAGE` | No | — | Optional override, pinned by digest (`<name>@sha256:<64 hex>`). Unset: the agent pulls `ghcr.io/<IMAGE_OWNER>/zilar-desk:<IMAGE_TAG>` (default `latest`) and pins it itself, so updates move the image along (T-1602). An old agent without a `ready` field uses this value. | No |

### Limits and ports

| Variable | Required | Default | What it does | Secret? |
|---|---|---|---|---|
| `RUNNER_HUB_PORT` | No | `3189` | Port the runner hub binds to loopback (integer `1`–`65535`; `server-schema.ts:174`). | No |
| `SHUTDOWN_DRAIN_MS` | No | `5000` | Milliseconds the server keeps serving after SIGTERM (draining, `/health` 503) before stepping down the leader and closing (integer `0`–`60000`; `server-schema.ts:175-186`, `startup/components.ts:300`). | No |

## 3. Feature flags: what each one turns on, and what else it needs

- **`AGENT_GATEWAY_ENABLED`** (T-0034) — the gateway logs each active AI in over XMPP, reconciles room joins, and answers owner DMs and `@mentions`. It also needs `ZILAR_KEY_ENCRYPTION_KEY`: without the cipher it logs `agent gateway needs the key cipher; staying off` and stays off (`apps/server/src/agents/gateway/lifecycle.ts:133-140`). Each turn calls the AI's own provider connection, so no platform key is involved.
- **`TOOLS_ENABLED`** (T-0105) — builds the sandbox runner and registers `tool.*`/`routine.*`. `routine.schedule` is registered only when `ROUTINES_ENABLED` is also true; off, manual runs answer 501 `runner_unavailable` (`startup/components.ts:111-122`). Tool code written by models runs on this server — see `docs/TOOL_SANDBOX.md`.
- **`ROUTINES_ENABLED`** (T-0104) — starts the routines scheduler; without a tool runner (`TOOLS_ENABLED`) it logs one warning and stays off (`routines/wiring.ts:40-49`).
- **`WEB_TOOLS_ENABLED`** (T-0125) — registers the keyless gateway web tools; `WEB_SEARCH_PROVIDER=none` drops `web.search`. Outbound requests come from this server — see `docs/TOOL_SANDBOX.md`.
- **`PUSH_ENABLED`** (T-0119) — starts the push component and its routes. Needs the four `PUSH_*` values below it, `PUSH_STORAGE_KEY` and `XMPP_ARCHIVE_DATABASE_URL`; a missing piece logs one error and push stays off (`apps/server/src/push/config.ts:232-269`, `leader/start.ts:78-94`).
- **`RUNNER_HUB_ENABLED`** (T-0071) — starts the loopback runner hub; a bind failure logs and leaves the API running (`leader/start.ts:143-167`).
- **`ROUTINES_ENABLED`, `LISTENER_ENABLED`, `DESK_AGENT_SOCKET`/`DESK_IMAGE`** — see the tables above; the listener is currently inert (`startup/components.ts:204-211`).

## 4. Background jobs and health checks

Leader-only loops start after the HTTP edge is up and this instance wins the advisory lock; a follower runs none of them (`apps/server/src/leader/start.ts`, `apps/server/src/startup/components.ts:256-300`).

| Job | Where | Cadence |
|---|---|---|
| Approvals sweeper | `apps/server/src/approvals/sweeper.ts` | `60_000` ms (`:41`), first tick after one interval |
| Action-recovery timer | `apps/server/src/actions/recovery.ts` | `5 * 60_000` ms (`:31`); one extra `recoverStuck` sweep at startup (`leader/start.ts:189-209`) |
| Task-event retention sweep | `apps/server/src/agents/log/retention.ts` | `60_000` ms (`:54`), 30-day window (`:1-14`) |
| Routines scheduler | `apps/server/src/routines/scheduler.ts` | `30_000` ms (`:56`), up to 5 due routines per tick (`:58`) |
| Agent gateway reconcile | `apps/server/src/agents/gateway/contracts.ts:81` (used in `agents/gateway.ts:61`) | `RECONCILE_INTERVAL_MS = 60_000` ms, per-AI reconnect backoff |
| Runner hub key cache / `last_seen` poll | `apps/server/src/machines/hub.ts` | `30_000` ms / `LAST_SEEN_MIN_INTERVAL_MS = 60_000` ms (`:241`) |

`GET /health` (`apps/server/src/health.ts:48-94`, served via `apps/server/src/app/routes-health.ts`) pings Postgres for up to `1000` ms and returns JSON. `200` while the database answers and the instance is not draining; `503` when the database does not answer or the process is draining. The body carries `ok`, `name`, `version`, `commit` (`ZILAR_COMMIT`), `protocolVersion`, `minClientProtocol`, `db`, `ejabberd` (probed at most once per `15_000` ms), `push` (`online`/`offline`/`unknown`), an optional `ejabberdSchema`, `leader`, `draining` and optional `lastPushSentAt`/`lastPushFailure`. Only the database result and the drain make the container unhealthy; the rest is informational.

## 5. Where to set them

- **Plain stack:** copy `deploy/.env.example` to `deploy/.env` and fill it in; `./zilar init` writes that file (generating passwords, the VAPID pair and the storage keys) and `./zilar up` starts the stack, AI-computer services included (`deploy/zilar`). `./zilar update` clears a `DESK_IMAGE` pin it wrote itself, so the jail image follows the release. The Compose files pass each variable to the `server` service (`deploy/docker-compose.yml:109-214`).
- **Coolify:** the same variables are set in the Coolify app's environment UI; Coolify derives `SERVICE_*` secrets and URLs and the app compose reads them (`deploy/coolify/docker-compose.yml:121-221`, `deploy/coolify/docker-compose.app.yml:120-221`). AI computers need no variable: run `curl -fsSL https://get.zilar.app | sudo sh -s -- --desks-host` once on the host.
- **Live:** change the value in the same place (Coolify app variables or `deploy/.env`) and restart the `server` service. Variables the server does not read — `ZILAR_DOMAIN`, `ACME_EMAIL`, `HTTP_PORT`, `HTTPS_PORT`, `POSTGRES_PASSWORD`, `IMAGE_OWNER`, `IMAGE_TAG`, `ZILAR_DB_PASSWORD`, `EJABBERD_DB_PASSWORD`, `ZILAR_ARCHIVE_DB_PASSWORD`, `DESKS_ENABLED`, `DESK_RUNTIME`, `DESK_MAX_RUNNING`, `DESK_NETWORK`, `DESK_CGROUP_PARENT`, `DESK_WORKSPACE_*`, `DESK_EGRESS_*` and the Coolify `SERVICE_*` names — configure the containers or the `./zilar` CLI, not `@zilar`.
