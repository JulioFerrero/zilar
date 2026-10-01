# Galena server configuration reference

This page is the source of truth for running `@galena`. Every variable here is read by `apps/server/src/config.ts` or `apps/server/src/xmpp/config.ts`; the description and default come from those files. Placeholders only — use `CHANGE_ME` everywhere a real value would go.

## 1. What runs where

A Galena install has one TypeScript server, one React web app, one Postgres database (with `pgvector` enabled), one ejabberd instance, one LiteLLM proxy and an optional runner hub. The numbers below are what the code actually binds to; check them against `infra/docker-compose.dev.yml` and `apps/server/src/config.ts` before changing anything.

| Process | What it is | Default port (loopback) | Source |
|---|---|---|---|
| Galena server (`@galena`) | `@hono/node-server` HTTP API | `PORT` (default `3000`; the local dev stack uses `3188`) | `config.ts:39`, `index.ts:202` |
| Web dev server (Vite) | React app, proxies `/api` to the server | `5173` | `apps/web/vite.config.ts:16` |
| Postgres (`pgvector/pgvector:0.8.6-pg18-trixie`) | data store | `5432` | `infra/docker-compose.dev.yml:21` |
| ejabberd (`26.07`) | XMPP server (C2S + admin API + WebSocket) | `5222` (C2S), `5280` (HTTP/WS + admin) | `infra/docker-compose.dev.yml:49-50` |
| LiteLLM proxy (`1.102.1`) | LLM gateway and key vault | `4000` | `infra/docker-compose.dev.yml:87`, `ai/litellm-client.ts:6` |
| Runner hub (optional) | tunnel for approved AI runners | `RUNNER_HUB_PORT` (default `3189`) | `config.ts:77-84`, `index.ts:212` |
| `ACTION_DEMO_ENABLED` | No | `false` | Registers the harmless `demo.echo` action (tier 2, no side effects) so an owner can prove the approval flow end to end: ask the AI in its DM to echo a text, approve the card, see the result (`actions/demo.ts`, `config.ts`). With the flag off no action is registered and the AI is not offered the `request_action` tool. | Not a secret. For testing only. |

Port `3000` is the code default but the local dev stack does not use it (it belongs to another app on the owner's machine). The Galena server's `BETTER_AUTH_URL` defaults to `PUBLIC_URL` (`config.ts:103`), and `apps/web/vite.config.ts:16` proxies `/api` to `GALENA_API_URL` (default `http://localhost:3000`), so the dev stack runs the server with `PORT=3188` and Vite with `GALENA_API_URL=http://localhost:3188`. See `docs/LEAD_PLAYBOOK.md` §12 for the exact start commands.

## 2. Environment variables

The server reads every variable below. Two schemas feed into one `ServerConfig`:

- the core schema at `apps/server/src/config.ts:36-104`
- the XMPP schema at `apps/server/src/xmpp/config.ts:13-21` (called from `config.ts:118`)

A value shown as `CHANGE_ME` here is what `apps/server/.env.example` ships with. Real values go in `apps/server/.env` and `infra/.env`; both are git-ignored and never logged (`apps/server/src/logger.ts:4-16` redacts secrets, including `SMTP_PASSWORD` and `SMTP_USER`).

**Secret** in the *Notes* column means: never commit, never paste into chat, never echo in a config error. The config schemas validate presence, length and shape but never print a value back (`config.ts:142-158`, `xmpp/config.ts:38-44`).

### Core

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `NODE_ENV` | No | `development` | One of `development`, `test`, `production`. Switches `createLogger` between `pino-pretty` and plain JSON (`logger.ts:24-32`), and `createMailer` refuses `production` without a real provider (`auth/mailer.ts:181-198`). | Not a secret. |
| `PORT` | No | `3000` | TCP port the HTTP server binds to (`index.ts:202`). Integer in `[1, 65535]`. | The local stack uses `3188`; `3000` belongs to another app on this host. |
| `DATABASE_URL` | Yes | — | Postgres connection string used by every Drizzle call (`db/client.ts`, `index.ts:47`). Schema accepts `postgres://` and `postgresql://`. | **Secret.** Password goes here. |
| `LOG_LEVEL` | No | `info` | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace` (`config.ts:41`). Passed straight to pino (`logger.ts:18`). | Not a secret. |
| `PUBLIC_URL` | No | `http://localhost:3000` | Public base URL the server is reachable at. Used for cookie scoping, the `allowedOrigins` allow-list (`app.ts:311-316`) and as the default for `BETTER_AUTH_URL`. | Not a secret, but a wrong value breaks CORS on the web app. |
| `BETTER_AUTH_SECRET` | Yes | — | Secret Better Auth uses to sign sessions and encrypt data. Must be at least 32 characters (`config.ts:43`); `config.test.ts:184-192` proves a short one fails validation without echoing the value. | **Secret.** Generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | No | `PUBLIC_URL` | Base URL Better Auth advertises. Defaults to `PUBLIC_URL` (`config.ts:103`). | Not a secret. |
| `WEB_ORIGINS` | No | `http://localhost:5173` | Comma-separated list of web origins allowed to call the API with cookies (`app.ts:130-144`). Each entry is normalised to its URL origin (scheme + host + port) and deduplicated (`config.ts:24-34`). Must contain at least one entry. | Not a secret. The empty list fails at startup. |

### Mail (sign-in codes)

Galena signs people in only with an email one-time code, so every real install needs a mailer (`auth/mailer.ts`). `createMailer` picks by `MAIL_TRANSPORT` and verifies an SMTP connection at startup without crashing when it fails (a temporary mail outage must not take the chat down; `mailer.ts:209-216`).

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `MAIL_TRANSPORT` | In production | `console` outside production, unset in production | `console` writes codes to the log (development only); `smtp` sends real mail through nodemailer (`mailer.ts:83-164`). Unset in production refuses to start with `No email provider is configured…` naming these variables (`mailer.ts:185-191`). | Not a secret. |
| `SMTP_HOST` | With `smtp` | — | SMTP host to connect to (`config.ts:67`). | Not a secret. Missing it fails startup with `SMTP_HOST is required when MAIL_TRANSPORT=smtp`. |
| `SMTP_PORT` | No | `587` | SMTP port, integer in `[1, 65535]` (`config.ts:70-78`). | Not a secret. |
| `SMTP_SECURE` | No | `false` | `'true'` = implicit TLS (normally port 465); `'false'` = STARTTLS is required (`requireTLS: true`, never falls back to plaintext) (`mailer.ts:103-108`). | Not a secret. Junk values fail startup. |
| `SMTP_USER` / `SMTP_PASSWORD` | Together or neither, with `smtp` | — | SMTP credentials; no auth when both are absent. Setting only one fails startup (`config.ts:196-244`). | **Secrets.** Never logged, never echoed in a config error (`config.test.ts` proves the password is absent from messages). |
| `MAIL_FROM` | With `smtp` | — | Sender on sign-in mails, e.g. `Galena <no-reply@example.com>`. Validated as a mailbox at startup. | Not a secret. Missing it fails startup with `MAIL_FROM is required when MAIL_TRANSPORT=smtp`. |
| `MAIL_REPLY_TO` | No | — | Optional `Reply-To` header on sign-in mails. Validated as a mailbox when set. | Not a secret. |
| `MAIL_ALLOW_CONSOLE_IN_PRODUCTION` | No | `false` | Explicit opt-in that lets a single-admin private install run with `MAIL_TRANSPORT=console` in production. The server logs a loud startup warning and the codes appear in the log at `warn` level (`mailer.ts:173-207`). | Not a secret. Unsuitable for anyone but the operator. |

Mails are plain text plus a minimal HTML alternative, English only, with one subject per purpose (`Your Galena sign-in code`, `Verify your email`, `Reset your Galena sign-in`, `Confirm your new email`): the code, its validity in minutes (`OTP_EXPIRES_IN_SECONDS`, 10 minutes today), and "If you did not ask for this, ignore this email." — no links, no images. On delivery failure `sendOtp` throws a generic `MailerDeliveryError` (the auth route answers the same way it does today) and logs only the SMTP response code, never the code or the address echo. A connection timeout (10 s) and a send timeout (20 s) keep a dead SMTP server from hanging sign-in (`mailer.ts:27-28`).

### XMPP / ejabberd

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `EJABBERD_API_URL` | No | `http://127.0.0.1:5280/api` | Admin HTTP API the server uses to create accounts, add roster items and manage MUC rooms (`xmpp/admin-client.ts`, `xmpp/config.ts:14`). Trailing slashes are stripped (`xmpp/config.ts:46-48`, `56`). | Not a secret, but in production it should be `https://`. |
| `EJABBERD_ADMIN_JID` | Yes | — | Bare JID of the ejabberd admin account the server logs in as. Must match `EJABBERD_ADMIN_JID` in `infra/.env` so the container registers the same account on first boot (`infra/docker-compose.dev.yml:60`). | **Treat as semi-secret** — knowing the admin JID plus its password is enough to call the admin API. |
| `EJABBERD_ADMIN_PASSWORD` | Yes | — | Password for the admin account above. Must match `EJABBERD_ADMIN_PASSWORD` in `infra/.env` so the container's `REGISTER_ADMIN_PASSWORD` accepts it (`infra/docker-compose.dev.yml:61`). | **Secret.** Never log. |
| `XMPP_DOMAIN` | No | `galena.localhost` | XMPP domain users are registered on. Lowercase host name, `1-253` characters (`xmpp/config.ts:5-9`, `17`). | Not a secret. |
| `XMPP_MUC_DOMAIN` | No | `rooms.galena.localhost` | MUC (group chat) domain. Same shape rules as `XMPP_DOMAIN` (`xmpp/config.ts:18`). | Not a secret. |
| `XMPP_WS_PUBLIC_URL` | No | `ws://127.0.0.1:5280/ws` | Public WebSocket URL clients connect to. Must be `ws://` or `wss://` (`xmpp/config.ts:19`). | Not a secret. In production use `wss://`. |
| `GALENA_XMPP_JWT_SECRET` | Yes | — | HS256 secret the server signs short-lived XMPP login JWTs with. Must be at least 32 characters and match `GALENA_XMPP_JWT_SECRET` in `infra/.env` so the ejabberd container's `jwt-entrypoint.sh` derives the same JWK (`infra/docker-compose.dev.yml:63`). | **Secret.** Generate with `openssl rand -base64 48`. Changing it later invalidates every issued token. |
| `XMPP_ARCHIVE_DATABASE_URL` | No | — | Connection string for the read-only `galena_archive` role on the ejabberd MAM database (`search/service.ts`, `search/routes.ts`). Absent → `GET /api/search` answers 501 `search_unavailable` and the web hides the feature. The pool is separate from the app pool (`max` 3) with a 3 s statement timeout. | **Secret.** Password goes here. See "Message search" below. |

### Message search (T-0117)

Search reads the ejabberd `archive` table through a **read-only** role. Create it:

1. Add `GALENA_ARCHIVE_DB_PASSWORD=CHANGE_ME` to `infra/.env` (git-ignored; generate with `openssl rand -base64 32`).
2. `infra/postgres/init/20-search-reader.sql` creates the `galena_archive` role on first start of an empty data volume, grants it `CONNECT` + `USAGE ON SCHEMA public`, grants `SELECT` on `archive` when the table already exists, and sets `ALTER DEFAULT PRIVILEGES FOR ROLE ejabberd … GRANT SELECT ON TABLES TO galena_archive` so tables ejabberd creates later (including its `archive`) are readable too.
3. On an existing volume, apply the same grants manually: `GRANT SELECT ON archive TO galena_archive;` (plus the `ALTER DEFAULT PRIVILEGES` line above if the role predates it).
4. Point the server at it: `XMPP_ARCHIVE_DATABASE_URL=postgres://galena_archive:CHANGE_ME@127.0.0.1:5432/ejabberd` (in `apps/server/.env`, git-ignored).

The shape of the table and the query design are in `docs/SEARCH_NOTES.md` (≤ 60 lines). The query text is never logged or stored: the route logs only the result count and duration.

### Smarter matching (T-0142)

No database extension is used. The first pass folds accents/case (`translate(lower(txt), …)`) and matches the last query term as a prefix (`to_tsquery` with `:*`, built from sanitized tokens). When it returns fewer rows than the page limit, a bounded second pass (same scope, cutoff, cap, newest first — never for queries shorter than 3 characters) scores candidates in code with Damerau-Levenshtein distance (terms of 1–3 chars: exact/prefix only; 4–7 chars: distance 1; 8+ chars: distance 2). Each result carries an optional `match: 'exact' | 'fuzzy'` field both clients ignore.

### AI (LiteLLM) and provider-key encryption

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `LITELLM_BASE_URL` | No | none → falls back to `http://127.0.0.1:4000` (`ai/litellm-client.ts:6`) | Base URL for LiteLLM admin calls and the gateway's LLM calls (`ai/integration.ts:19`, `agents/gateway.ts:283`). | Not a secret. The default lives in the AI module, not the schema, so an absent variable does not change the parsed config (`ai/litellm-client.ts:4-6`). |
| `LITELLM_MASTER_KEY` | No | — | Bearer token for the LiteLLM admin API (`ai/integration.ts:18`, `ai/litellm-client.ts`). Absent → the AI and gateway code refuses to call LiteLLM; every AI route answers 503 (`app.ts:210-227`). | **Secret.** |
| `GALENA_KEY_ENCRYPTION_KEY` | No | — | Envelope-encryption master key for provider keys stored in `provider_connections` (`connections/crypto.ts:1-103`). Must be at least 32 characters when set (`config.ts:61`). Absent → `provider_connections` and AI write routes answer 503 (`app.ts:184-203`, `app.ts:204-227`); the cipher is what unlocks AI access to LiteLLM. | **Secret.** Generate with `openssl rand -base64 48`. Changing it makes every stored provider key undecryptable. |

### GitHub App (git proxy)

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `GITHUB_APP_ID` | No | — | GitHub App id used to sign installation-token JWTs (`git/token.ts:41-69`). | **Treat as semi-secret.** All three `GITHUB_APP_*` variables must be set together; a partial set fails at startup (`config.ts:86-100`). |
| `GITHUB_APP_PRIVATE_KEY` | No | — | PKCS#8 PEM the server signs the App JWT with. Held in memory only; injected by the proxy per request (`git/proxy.ts:1-179`). | **Secret.** The PEM body must be on one logical line in `.env`; wrap in single quotes. |
| `GITHUB_APP_INSTALLATION_ID` | No | — | Installation id GitHub exchanges the App JWT for an installation access token (`git/token.ts:72-115`). | **Treat as semi-secret.** |

The git proxy uses `https://api.github.com` by default (`git/token.ts:12`); no env variable overrides it today.

### Feature flags

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `AGENT_GATEWAY_ENABLED` | No | `false` | Off by default; set to `'true'` to enable (`config.ts:65-68`). Wires the agent gateway into `index.ts` and starts every active AI over XMPP (`agents/gateway.ts:1353-1364`). Needs `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY` and `GALENA_KEY_ENCRYPTION_KEY` to do anything useful — without any of those the gateway logs `agent gateway needs LiteLLM and the key cipher; staying off` and stays off (`agents/gateway.ts:1361-1364`). | Not a secret. |
| `RUNNER_HUB_ENABLED` | No | `false` | Off by default; set to `'true'` to enable the tunnel for approved runners (`config.ts:73-76`). When on, the server binds `RUNNER_HUB_PORT` to `127.0.0.1` (`machines/hub.ts:200-344`) and validates that the gateway URL is `http://` (`machines/hub.ts:356-365`). A misconfigured URL exits before the HTTP server starts (`index.ts:56-59`). | Not a secret. |
| `RUNNER_HUB_PORT` | No | `3189` | TCP port the runner hub tunnel binds to. Integer in `[1, 65535]` (`config.ts:77-84`). | Not a secret. |
| `ROUTINES_ENABLED` | No | `false` | Off by default; set to `'true'` to enable the routines scheduler (`routines/scheduler.ts`, `config.ts`). When on, the server fires due routines every 30 s through the configured tool runner and posts the output as the AI (`index.ts`). With the flag on but no tool runner configured, the scheduler logs one warning and stays off. | Not a secret. |
| `TOOLS_ENABLED` | No | `false` | Off by default; set to `'true'` to enable AI-built tools and routines (`tools/adapters.ts`, `config.ts`). When on, the server builds the real sandbox runner (`sandbox/run-tool.ts` with default limits), registers the `tool.*` / `routine.*` action adapters in the action registry (next to the demo adapter when it is on), passes the same runner to the tools routes and the routines scheduler, and registers `routine.schedule` only when `ROUTINES_ENABLED` is also `true`. With the flag off no adapter is registered and manual runs answer 501 `runner_unavailable`. **Warning: tool code written by models runs on this server in the sandbox — see `docs/TOOL_SANDBOX.md`.** | Not a secret. |
| `WEB_TOOLS_ENABLED` | No | `false` | Off by default; set to `'true'` to enable the gateway-level web tools for AIs (`web-tools/adapters.ts`, `config.ts`). When on, the server registers `web.fetch`, `web.wikipedia`, `web.price`, `web.feed` and a best-effort `web.search` in the action registry (next to the demo and tool adapters when they are on). Keyless, no account: reading public pages, Wikipedia summaries, RSS/Atom feeds and market prices (crypto, stocks, indexes, gold) work with nothing to sign up for. With the flag off no `web.*` adapter is registered. **Warning: these tools make outbound requests from this server — see `docs/TOOL_SANDBOX.md` for the network guard (DNS pinned, private addresses refused, no redirects, 10 s timeout, 2 MiB cap).** | Not a secret. |
| `WEB_SEARCH_PROVIDER` | No | `duckduckgo-html` | The search backend behind the port (`web-tools/search.ts`, `config.ts`). `duckduckgo-html` parses one DuckDuckGo HTML result page per call and may be blocked or change its markup at any time (then `web.search` honestly answers `search unavailable right now`); `none` unregisters `web.search`. A real provider (SearXNG, Exa) can later be added as one adapter behind the same port. Junk values fail startup. | Not a secret. |

### Voice, git proxy, limits / timeouts

The voice engine itself (`voice/engine.ts:1-204`) takes no env vars; the routes mount with a default `ffmpeg`/`ffprobe` from `PATH` and no upload-size cap is configurable today. The git proxy takes no env vars apart from the three `GITHUB_APP_*` ones above. The only timeout/cap constants live in code:

- approvals sweeper ticks every `60_000` ms by default (`approvals/sweeper.ts:40`)
- action-recovery timer ticks every `5 * 60_000` ms by default (`actions/gateway.ts:128`)
- agent gateway reconciles every `RECONCILE_INTERVAL_MS = 60_000` ms (`agents/gateway.ts:89`)
- agent gateway reconnect backoff: base `RETRY_BASE_DELAY_MS = 5_000` ms, doubles per attempt, capped at `RETRY_MAX_DELAY_MS = 60_000` ms (`agents/gateway.ts:91-93`)
- agent gateway room rate limit: `GROUP_TURNS_PER_WINDOW = 6` turns per `GROUP_RATE_WINDOW_MS = 10 * 60_000` ms (`agents/gateway.ts:113-114`)
- voice probe timeout `10_000` ms, voice convert timeout `30_000` ms (`voice/engine.ts:3-4`)
- graceful shutdown grace period `3_000` ms, hard exit `15_000` ms (`index.ts:271-272`)
- action gateway: approval TTL `30 * 60_000` ms, stuck-running cutoff `10 * 60_000` ms, summary cap 500 chars, stored-args cap `20 * 1024` bytes (`actions/gateway.ts:39-53`)

None of these are env vars yet; they are values to be aware of when sizing or debugging the server.

## 3. Feature flags and what each one enables

### `AGENT_GATEWAY_ENABLED` (T-0034) — `config.ts:65-68`, wired in `index.ts:179-196`

Default `false`. When `true`, the server builds an agent gateway (`createAgentGateway`), then starts it after the HTTP listener is up (`index.ts:202`, `index.ts:232-240`). The gateway:

- logs each active AI in over XMPP and replies to its owner in DMs and to `@mentions` in groups (`agents/gateway.ts:1353-1437`)
- exposes a draft hub so the web app can stream live reply drafts over `/api/drafts/stream` (`index.ts:193`, `drafts/hub.ts`)
- drifts each AI's room joins toward the database every `RECONCILE_INTERVAL_MS` (`agents/gateway.ts:280-281`, `1433-1438`)
- silently no-ops a stop that lands mid-turn (`agents/gateway.ts:499-518`)

**Prerequisites that turn the flag into a no-op** (the server stays up, the gateway does nothing):

- `LITELLM_BASE_URL` unset → the gateway logs `agent gateway needs LiteLLM and the key cipher; staying off` and exits `start()` early (`agents/gateway.ts:1361-1364`).
- `LITELLM_MASTER_KEY` unset → same `litellm === undefined` check (`agents/gateway.ts:347-349`, `1361-1364`).
- `GALENA_KEY_ENCRYPTION_KEY` unset → `cipher === undefined`, same outcome (`agents/gateway.ts:1361-1364`, `connections/crypto.ts:98-103`).

The flag gates only the gateway's XMPP connections. The AI HTTP routes depend on LiteLLM and the key cipher instead: without `LITELLM_MASTER_KEY` or `GALENA_KEY_ENCRYPTION_KEY` the AI write routes answer 503 `ais_unavailable` and the connections routes answer 503 `connections_unavailable` (`app.ts:185`, `app.ts:207`), whatever the flag says.

### `RUNNER_HUB_ENABLED` (T-0071) — `config.ts:73-76`, validated in `index.ts:56-59`, started in `index.ts:211-226`

Default `false`. When `true`:

- `assertRunnerHubConfig` runs at startup and exits with a clear `HubConfigError` if the gateway URL is not `http://` (`machines/hub.ts:356-365`).
- the server binds `RUNNER_HUB_PORT` to `127.0.0.1` after the HTTP API is listening, so a bind failure (port in use) cannot take the API down (`index.ts:211-226`).
- the hub's in-memory approved-key cache refreshes every `30_000` ms (`machines/hub.ts:53`, `127-129`) and the `last_seen_at` poll runs every `LAST_SEEN_MIN_INTERVAL_MS = 60_000` ms (`machines/hub.ts:229`).

`RUNNER_HUB_ENABLED=false` is the default; `isMachineOnline` always returns `false` and every machines route that asks the hub gets `online: false` (`index.ts:68-71`, `app.ts:56-57`).

### Voice and git flags

Neither has an env flag today. The voice engine and routes always mount (`app.ts:175-182`); the git routes always mount (`app.ts`'s `createGitRoutes`); what differs is whether the underlying dependency is configured (ffmpeg/ffprobe on `PATH` for voice, the three `GITHUB_APP_*` variables for git).

### Topics (T-0108)

Topics add no env vars. Every topic is its own members-only XMPP MUC room on `XMPP_MUC_DOMAIN`, created through the same ejabberd admin API as groups (`create_room_with_opts` with `members_only`, `persistent`, `mam`, non-`anonymous`). The server syncs each room's affiliations from the database (`topics` + `topic_members` + `group_members`): a topic creation or membership change that cannot reach ejabberd answers `502`/`503` instead of leaving the database and the rooms disagreeing. Creation is rate-limited to 30 topics per hour per user (in-memory, per process, like the other caps in `rate-limit.ts`).

### Chat preferences (T-0113)

Chat preferences add no env vars. `chat_prefs` holds one row per (user, chat JID) for mute (`muted_until`, far-future means forever), archive (`archived`) and pin (`pinned_at`); a row back at all defaults is deleted. `GET /api/chat-prefs` returns the caller's rows; `PUT /api/chat-prefs/:chatJid` patches one row (60 writes/minute/user, 200 rows/user, 20 pins/user). A user can only set prefs for DMs with their contacts or own AIs, and for group General/topic rooms they can see — anything else 404s. Prefs never leak (own-rows only, no audit entries).

### Push notifications (T-0119)

Web push through ejabberd's `mod_push` plus an installable web app (PWA). Off by default (`PUSH_ENABLED=false`); when on, the server runs as an XEP-0114 component that receives XEP-0357 publish IQs and fans them out to browsers with `web-push` (VAPID + RFC 8291: the payload is encrypted end to end, relays see ciphertext).

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `PUSH_ENABLED` | No | `false` | `'true'` starts the push component and enables the `/api/push/*` routes. With anything else the routes answer 404 and no component starts. | Not a secret. |
| `PUSH_VAPID_PUBLIC_KEY` / `PUSH_VAPID_PRIVATE_KEY` | With push | — | VAPID key pair the browsers subscribe against. Generate with `web-push generate-vapid-keys` (one-off; needs the `web-push` CLI, not a dependency). | **Secrets** (the private key; the public key is served to logged-in browsers at `GET /api/push/config`). |
| `PUSH_VAPID_SUBJECT` | With push | — | Contact URI for the push services, e.g. `mailto:admin@example.com`. | Not a secret. |
| `PUSH_COMPONENT_JID` | With push | — | The component domain, e.g. `push.galena.localhost`. Must equal the host key written literally under the `ejabberd_service` listener in `infra/ejabberd/ejabberd.yml` (ejabberd does not expand macros in map keys). | Not a secret. |
| `PUSH_COMPONENT_SECRET` | With push | — | Shared secret with ejabberd's `ejabberd_service` listener. Must equal the container's `EJABBERD_MACRO_PUSH_COMPONENT_SECRET`. | **Secret.** Generate with `openssl rand -base64 32`. |
| `PUSH_COMPONENT_PORT` | No | `5347` | Component listener port. Integer in `[1, 65535]`. | Not a secret. Must match the `port` in `infra/ejabberd/ejabberd.yml`. |
| `PUSH_STORAGE_KEY` | With push | — | Seals browser subscription keys at rest (AES-256-GCM envelope). At least 32 characters. Rotating it orphans existing rows (the component drops undecryptable devices instead of sending). | **Secret.** Generate with `openssl rand -base64 48`. |
| `XMPP_ARCHIVE_DATABASE_URL` | With push | — | Same read-only archive reader as message search (see "Message search" above). Push **requires** it: without the archive the component cannot resolve who/where and drops notifications instead of guessing. The server refuses to start the component without it. | **Secret.** |

Wiring a new install (all three must agree, then restart ejabberd so the listener and `mod_push_keepalive` take effect):

1. `infra/ejabberd/ejabberd.yml` ships the `ejabberd_service` listener on port 5347 (all container interfaces; the compose file publishes it on `127.0.0.1` only) with the host written literally (`push.galena.localhost`) and the `PUSH_COMPONENT_SECRET` macro (`CHANGE_ME` default, never committed).
2. `infra/docker-compose.dev.yml` already passes `EJABBERD_MACRO_PUSH_COMPONENT_SECRET: ${PUSH_COMPONENT_SECRET:-CHANGE_ME_PUSH_COMPONENT_SECRET}` to ejabberd and publishes `127.0.0.1:5347`. Set `PUSH_COMPONENT_SECRET` in `infra/.env` (git-ignored) to the same value as the server's `PUSH_COMPONENT_SECRET`.
3. `apps/server/.env` (git-ignored) needs the seven `PUSH_*` variables above plus `XMPP_ARCHIVE_DATABASE_URL`.

Behaviour: one push node per device (`POST /api/push/subscriptions` returns the `{ jid, node }` the browser enables over its own XMPP session — ejabberd requires the enable IQ from the user's session, there is no admin shortcut). Every topic/group room is created with `allow_subscription: true` (older rooms are reconciled with `change_room_option` at component start); members holding a push device are subscribed to the rooms they may see and unsubscribed when they lose access. At send time the component reads the newest archived message, re-checks mute (topics inherit the group General mute) and private-topic visibility with `canSeeTopic`, and sends `{ title: "Ana in Group › Topic", body: first 120 chars when the user's previews setting is on }` capped at 3000 bytes. Expired endpoints (404/410) delete the row; every publish IQ is answered `result` even when dropped. Devices with no send for 90 days list as `inactive`. `POST /api/push/test` (5 per 10 min per user) sends a fixed "Push notifications work on this device." payload. Logs carry ids only — never message text or endpoint URLs.

### Group invite links (T-0115)

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `WEB_BASE_URL` | No | `http://localhost:5173` | Web base URL baked into shareable group join links (`POST /api/groups/:id/invite-links` answers `{ id, token, url }` with `url = ${WEB_BASE_URL}/j/<token>`; `config.ts`). | Not a secret. Must be the URL people open in a browser, or copied links 404. |
| `TRUSTED_PROXY_HOPS` | No | `0` | How many right-most `x-forwarded-for` hops to trust when resolving the client IP for the per-IP invite-link join limiter (integer `0`–`5`; `config.ts`). `0` ignores proxy headers and uses the socket address. Set to `1` when the server sits behind one proxy (e.g. Caddy): the client IP is then the address the proxy appended on the right, while a forged left-most entry is ignored. Only the join limiter reads it. | Not a secret. Set it to the number of proxies in front of the server, or every user shares one IP budget. |

Shareable links join a **group** as `member` (public topics come with joining; private topics are never joined by link). Only the SHA-256 hash of the 32-byte token is stored — the token is shown once at creation and never logged or audited; the admin list carries the last-4 hint, label, uses and state, never tokens. At most 10 active links per group. Joining consumes one use with a conditional update (not revoked, not expired, under the cap), so two racing joins can never exceed `max_uses`. Unknown/expired/revoked/exhausted links answer the same 404 `invalid_link` (no leak of which); a full group answers 409 `group_full`. Join attempts are rate limited (20/hour/user, 60/hour/IP, in-memory per process, like the other caps in `rate-limit.ts`); behind a proxy set `TRUSTED_PROXY_HOPS` (above) so the per-IP budget is per client, not per proxy. Audited as `group.link_created`, `group.link_revoked`, `group.joined_by_link` (link id + hint only, never the token). The web `/j/<token>` page sends a signed-out visitor to the login with `next=/j/<token>` and returns them after sign-in. Invite-only sign-up is unchanged: a person without an account still needs a sign-up invite first.

### Stickers (T-0120)

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `STICKER_STORAGE_DIR` | No | `./data/stickers` | Directory sticker files are stored under. File names are `<uuid>.<ext>` (never user input). A relative value resolves against the server package root (`apps/server`), not the process cwd — the Dockerfile starts from `/app` while a developer may start from the repo root, and both land on the same directory. Absolute paths pass through unchanged. | Not a secret. Must be writable at startup — the server creates it when missing and exits with `STICKER_STORAGE_DIR (<dir>) is not writable` otherwise (`index.ts`). |

Uploaded stickers are validated by magic bytes (PNG or WebP only, ≤ 512 KiB, ≤ 512 × 512 px) and served with `Content-Type` from the stored mime, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: public, max-age=31536000, immutable` and `Content-Security-Policy: default-src 'none'; sandbox`. Deleting a pack removes its files; messages already sent keep their sticker URL, which no longer loads a sticker. Uploads are rate limited to 60/hour/user (in-memory, per process, like the other caps in `rate-limit.ts`). Audited as `sticker_pack.created` / `sticker_pack.deleted` (pack id only).

Docker/Coolify note: mount a persistent volume at `STICKER_STORAGE_DIR` (e.g. `./data/stickers`), or the files are lost when the container is replaced. The directory is git-ignored (`data/` is covered by the `*.log`-adjacent local-data rules; add an explicit `data/` entry if one is missing) and never backed up by the database dump — back it up with the volume.

### Channels (T-0124)

Channels add no env vars. A channel is a group with `kind = 'channel'` and an optional `description` (≤ 300, shown in the panel): one broadcast feed (its General topic — no more topics, `POST /api/groups/:id/topics` answers 400 `channel_has_no_topics`), where only owner/admins post and members subscribe. The posting rule is enforced by the room, not the UI: the feed room is created with `create_room_with_opts` carrying `moderated: true` **and** `members_by_default: false` (plus `members_only`, `persistent`, `mam`, non-`anonymous`), so subscribers (affiliation `member`) join as visitors — they read but cannot post — while affiliations `owner`/`admin` carry voice. The server keeps the mapping in sync — promotions/demotions (`PUT /api/groups/:id/members/:userId/role`, owner only) set the affiliation at once, and every later join/leave re-sync preserves admin voice (`desiredMembers` in `topics/rooms.ts`). Demoting or removing the last admin answers 409 `channel_needs_admin`, so the feed never falls silent. Reactions are messages in XMPP, so subscribers in a moderated room cannot react either: channels stay read-only for subscribers (mute via the T-0113 pref). The subscriber audience is visible to admins only (`GET /api/groups/:id` hides it from subscribers; `GET /api/groups/:id/members` answers the full audience for admins, the owner/admins slice for subscribers — who posts is public, every admin post carries its name — and 404 for strangers); the chat list carries `chatKind: 'channel'` plus `subscriberCount` and `description`. Invite links join channels as subscribers ("Join channel" wording via `kind` in the join preview). Promotions and demotions are audited as `group.role_changed` (group id, user ids and old/new roles only — never names). An AI posts in the feed only while its owner is a channel admin (affiliation `admin` through the same voice mapping; otherwise a voiceless `member`); AIs never see the audience list.

## 4. Database

### How migrations run

Migrations run **at startup**, not on demand. `index.ts:47-48` opens the database and immediately calls `runMigrations(db)`, which reads the SQL files in `apps/server/drizzle/` (the folder is `migrationsFolder` at `db/migrate.ts:6`) and applies them via Drizzle's `migrate` — `migratePglite` for tests, `migratePostgres` for production (`db/migrate.ts:8-14`). If a migration fails, the server never reaches `serve()` (`index.ts:202`).

For an out-of-band migration run (e.g. against a read replica during a deploy):

```bash
pnpm --filter @galena/server db:migrate
```

The command is defined at `apps/server/package.json:12` and runs `tsx --env-file-if-exists=.env src/db/migrate-cli.ts`, which loads the same config schema and exits non-zero on failure (`db/migrate-cli.ts:6`). Generate a new migration after editing `apps/server/src/db/schema.ts`:

```bash
pnpm --filter @galena/server db:generate
```

(`apps/server/package.json:11`; `drizzle.config.ts:1-3` pins the dialect, schema and out folder.) Never use `npx drizzle-kit …` — the lockfile drift and the missing schema flag produce surprising diffs.

### Append-only guarantees

`audit_log` is the only table with enforced append-only behaviour. `apps/server/drizzle/0013_audit_log_immutable.sql` installs three `BEFORE` triggers that reject `UPDATE`, `DELETE` and `TRUNCATE` with `RAISE EXCEPTION 'audit_log is append-only: … is not allowed'`, ERRCODE `P0001`. The triggers live on `audit_log_no_update`, `audit_log_no_delete` and `audit_log_no_truncate` and run a plpgsql function `audit_log_block_mutations()` — same function works under PGlite (tests) and Postgres (production). No other table in the schema has a comparable guarantee; everything else follows the normal `updated_at` pattern.

The audit recorder itself (`audit/service.ts:76-92`) wraps `recordAudit` so a database write error never propagates into the caller: a failed audit write logs `{ action, err }` and returns. Best-effort by design; the database trigger is the actual immutability.

## 5. Background jobs the server starts

The server starts four background loops after `serve()` resolves. Each is `unref()`'d (so it does not pin the event loop) and is closed during shutdown.

| Job | Where | Cadence | Started at |
|---|---|---|---|
| Approvals sweeper (`startApprovalsSweeper`) | `apps/server/src/approvals/sweeper.ts:36-108` | `60_000` ms (default) | `index.ts:246-250`; first tick after one interval, not at boot |
| Action-recovery timer (`startRecoveryStuckTimer`) | `apps/server/src/actions/gateway.ts:125-166` | `5 * 60_000` ms (default) | `index.ts:255-258`; first tick after one interval |
| Initial `recoverStuck` sweep | `actions/gateway.ts:509-550` | once, at startup | `index.ts:264-267`; runs in parallel with the timer |
| Agent gateway reconcile timer | `apps/server/src/agents/gateway.ts:1433-1438` | `RECONCILE_INTERVAL_MS = 60_000` ms | `index.ts:232-240` (`gateway.start()`) |
| Agent gateway retry | `agents/gateway.ts:464-491` | `RETRY_BASE_DELAY_MS = 5_000` ms, doubles per attempt, capped at `RETRY_MAX_DELAY_MS = 60_000` ms | inside the gateway, on a per-AI failed connect |
| Agent gateway room rate limit | `agents/gateway.ts:1125-1037` | window `GROUP_RATE_WINDOW_MS = 10 * 60_000` ms, cap `GROUP_TURNS_PER_WINDOW = 6` | enforced at turn time |
| Runner hub key-cache refresh | `apps/server/src/machines/hub.ts:114-129` | `30_000` ms (default) | inside `startRunnerHub` |
| Runner hub `last_seen_at` poll | `apps/server/src/machines/hub.ts:309-321` | `LAST_SEEN_MIN_INTERVAL_MS = 60_000` ms (default) | inside `startRunnerHub` |
| Runner hub itself (listener) | `apps/server/src/machines/hub.ts:264-274` | n/a | `index.ts:211-226`, only when `RUNNER_HUB_ENABLED=true` |
| Action announcer / agent gateway `postToChat` | `apps/server/src/actions/announce.ts`, `agents/gateway.ts:762-790` | per-call (no timer) | wired in `index.ts:86-142` and `index.ts:201` |

The agent gateway `start()` is launched with `void` and `.catch(...)` (`index.ts:232-240`) so a slow ejabberd or a missing token never blocks startup — the API stays up, the gateway keeps retrying.

## 6. Health and shutdown

### `/health`

`apps/server/src/app.ts:229-241` mounts a single GET route at `/health`. It runs `SELECT 1` against the database with a `1_000` ms timeout (`app.ts:79`, `app.ts:278-285`). The response is JSON:

- `200` + `{ ok: true, name: 'galena-server', version: serverVersion, protocolVersion, db: 'ok' }` when the ping resolves.
- `503` + `{ ok: false, name: 'galena-server', version: serverVersion, protocolVersion, db: 'down' }` when it does not.

The 503 is the only signal a load balancer should treat as unhealthy. `version` comes from `apps/server/package.json` (`version.ts:1-13`); `protocolVersion` from `@galena/protocol` (`app.ts:6`).

### Graceful shutdown

`SIGINT` and `SIGTERM` both call `shutdown(signal)` (`index.ts:310-315`). The shutdown sequence is in `index.ts:276-308`:

1. Sets `shuttingDown = true` so a second signal returns immediately.
2. Schedules `forceExit` for `FORCE_EXIT_MS = 15_000` ms (`index.ts:271`) — a `process.exit(1)` the logger fires once if anything below hangs.
3. Calls `server.close()`; SSE draft streams never end on their own, so the close path drops idle connections at once, calls `closeAllConnections()` after `CONNECTION_GRACE_MS = 3_000` ms (`index.ts:272`), and resolves when the listener is fully closed.
4. Closes the runner hub (`runnerHub.close()`) if one was started.
5. Awaits `gateway.stop()` so each AI is disconnected cleanly.
6. Closes the approvals sweeper (`approvalsSweeper.close()`) and the recovery timer (`recoveryStuck.close()`).
7. Closes the database (`close()`).
8. `process.exit(0)`.

If a step blocks past the grace period, the 15 s hard exit fires. That is the contract: in the worst case the server takes 15 s to die, and the API becomes unreachable after the `server.close()` resolves.

---

## Mismatches found

- `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY` and `GALENA_KEY_ENCRYPTION_KEY` are in `config.ts` (`config.ts:49-61`) but **not** listed in `apps/server/.env.example` (the example ends at `AGENT_GATEWAY_ENABLED`).
- `RUNNER_HUB_ENABLED` and `RUNNER_HUB_PORT` are in `config.ts` (`config.ts:73-84`) but **not** in `apps/server/.env.example`.
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_INSTALLATION_ID` are in `config.ts` (`config.ts:53-55`) but **not** in `apps/server/.env.example` (the App config is intentionally gated behind all-or-nothing validation; not listing them in the example is a UX miss).
- `EJABBERD_API_URL`, `XMPP_DOMAIN`, `XMPP_MUC_DOMAIN` and `XMPP_WS_PUBLIC_URL` are in both `apps/server/.env.example` and `xmpp/config.ts` with the same defaults — no mismatch, mentioned for completeness.

## Open questions

- Several env vars appear only in test files (`apps/server/src/agents/integration.test.ts`, `apps/server/src/ais/integration.test.ts`, `apps/server/src/connections/integration.test.ts`, `apps/server/src/voice/integration.test.ts`, `apps/server/src/ai/integration.ts`): `GALENA_AGENT_INTEGRATION`, `GALENA_AIS_INTEGRATION`, `GALENA_AI_MODELS_INTEGRATION`, `GALENA_VOICE_INTEGRATION`, `GALENA_CONNECTIONS_INTEGRATION`, `GALENA_LITELLM_INTEGRATION`, plus the matching `*_URL` and `XMPP_WS_URL` variants. Each is gated by `=== '1'` and only checked in tests, so it is configuration of the test suite, not the server. Listing them here would be misleading; the live server never reads them.
- The web app reads one env var of its own: `GALENA_API_URL` in `apps/web/vite.config.ts:16` (default `http://localhost:3000`). It is read by Vite, not by `@galena`, but it has to agree with `PORT` on the server or `/api` 404s. Not documented in `apps/web/.env.example` (there is no web `.env.example` file yet).
- The runner hub accepts a `gatewayUrl` argument whose default comes from `LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL` (`index.ts:58`, `index.ts:217`). Whether to expose that as a separate `RUNNER_HUB_GATEWAY_URL` env var is **unclear from the code** — the hub will reuse whatever LiteLLM uses, and a misconfigured scheme fails the explicit `http://` check.
- The agent gateway `postToChat` path is reachable only when `AGENT_GATEWAY_ENABLED=true`; whether a separate `ACTION_ANNOUNCER_ENABLED` flag exists to silence the action gateway announcer while keeping the gateway off is **unclear from the code** (the announcer object exists unconditionally in `index.ts:86-142` but `postToChat` is no-op while the gateway is stopped).