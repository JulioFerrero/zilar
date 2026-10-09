# Zilar server configuration reference

This page is the source of truth for running `@zilar`. Every variable here is read by `apps/server/src/config.ts` or `apps/server/src/xmpp/config.ts`; the description and default come from those files. Placeholders only — use `CHANGE_ME` everywhere a real value would go.

## 1. What runs where

A Zilar install has one TypeScript server, one React web app, one Postgres database (with `pgvector` enabled), one ejabberd instance, one LiteLLM proxy and an optional runner hub. The numbers below are what the code actually binds to; check them against `infra/docker-compose.dev.yml` and `apps/server/src/config.ts` before changing anything.

| Process | What it is | Default port (loopback) | Source |
|---|---|---|---|
| Zilar server (`@zilar`) | `@hono/node-server` HTTP API | `PORT` (default `3000`; the local dev stack uses `3188`) | `config.ts:39`, `index.ts:202` |
| Web dev server (Vite) | React app, proxies `/api` to the server | `5173` | `apps/web/vite.config.ts:16` |
| Postgres (`pgvector/pgvector:0.8.6-pg18-trixie`) | data store | `5432` | `infra/docker-compose.dev.yml:21` |
| ejabberd (`26.07`) | XMPP server (C2S + admin API + WebSocket) | `5222` (C2S), `5280` (HTTP/WS + admin) | `infra/docker-compose.dev.yml:49-50` |
| LiteLLM proxy (`1.102.1`) | LLM gateway and key vault | `4000` | `infra/docker-compose.dev.yml:87`, `ai/litellm-client.ts:6` |
| Runner hub (optional) | tunnel for approved AI runners | `RUNNER_HUB_PORT` (default `3189`) | `config.ts:77-84`, `index.ts:212` |
| `ACTION_DEMO_ENABLED` | No | `false` | Registers the harmless `demo.echo` action (tier 2, no side effects) so an owner can prove the approval flow end to end: ask the AI in its DM to echo a text, approve the card, see the result (`actions/demo.ts`, `config.ts`). With the flag off no action is registered and the AI is not offered the `request_action` tool. | Not a secret. For testing only. |

Port `3000` is the code default but the local dev stack does not use it (it belongs to another app on the owner's machine). The Zilar server's `BETTER_AUTH_URL` defaults to `PUBLIC_URL` (`config.ts:103`), and `apps/web/vite.config.ts:16` proxies `/api` to `ZILAR_API_URL` (default `http://localhost:3000`), so the dev stack runs the server with `PORT=3188` and Vite with `ZILAR_API_URL=http://localhost:3188`. See `docs/LEAD_PLAYBOOK.md` §12 for the exact start commands.

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

Zilar signs people in only with an email one-time code, so every real install needs a mailer (`auth/mailer.ts`). `createMailer` picks by `MAIL_TRANSPORT` and verifies an SMTP connection at startup without crashing when it fails (a temporary mail outage must not take the chat down; `mailer.ts:209-216`).

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `MAIL_TRANSPORT` | In production | `console` outside production, unset in production | `console` writes codes to the log (development only); `smtp` sends real mail through nodemailer (`mailer.ts:83-164`). Unset in production refuses to start with `No email provider is configured…` naming these variables (`mailer.ts:185-191`). | Not a secret. |
| `SMTP_HOST` | With `smtp` | — | SMTP host to connect to (`config.ts:67`). | Not a secret. Missing it fails startup with `SMTP_HOST is required when MAIL_TRANSPORT=smtp`. |
| `SMTP_PORT` | No | `587` | SMTP port, integer in `[1, 65535]` (`config.ts:70-78`). | Not a secret. |
| `SMTP_SECURE` | No | `false` | `'true'` = implicit TLS (normally port 465); `'false'` = STARTTLS is required (`requireTLS: true`, never falls back to plaintext) (`mailer.ts:103-108`). | Not a secret. Junk values fail startup. |
| `SMTP_USER` / `SMTP_PASSWORD` | Together or neither, with `smtp` | — | SMTP credentials; no auth when both are absent. Setting only one fails startup (`config.ts:196-244`). | **Secrets.** Never logged, never echoed in a config error (`config.test.ts` proves the password is absent from messages). |
| `MAIL_FROM` | With `smtp` | — | Sender on sign-in mails, e.g. `Zilar <no-reply@example.com>`. Validated as a mailbox at startup. | Not a secret. Missing it fails startup with `MAIL_FROM is required when MAIL_TRANSPORT=smtp`. |
| `MAIL_REPLY_TO` | No | — | Optional `Reply-To` header on sign-in mails. Validated as a mailbox when set. | Not a secret. |
| `MAIL_ALLOW_CONSOLE_IN_PRODUCTION` | No | `false` | Explicit opt-in that lets a single-admin private install run with `MAIL_TRANSPORT=console` in production. The server logs a loud startup warning and the codes appear in the log at `warn` level (`mailer.ts:173-207`). | Not a secret. Unsuitable for anyone but the operator. |

Mails are plain text plus a minimal HTML alternative, English only, with one subject per purpose (`Your Zilar sign-in code`, `Verify your email`, `Reset your Zilar sign-in`, `Confirm your new email`): the code, its validity in minutes (`OTP_EXPIRES_IN_SECONDS`, 10 minutes today), and "If you did not ask for this, ignore this email." — no links, no images. On delivery failure `sendOtp` throws a generic `MailerDeliveryError` (the auth route answers the same way it does today) and logs only the SMTP response code, never the code or the address echo. A connection timeout (10 s) and a send timeout (20 s) keep a dead SMTP server from hanging sign-in (`mailer.ts:27-28`).

### XMPP / ejabberd

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `EJABBERD_API_URL` | No | `http://127.0.0.1:5280/api` | Admin HTTP API the server uses to create accounts, add roster items and manage MUC rooms (`xmpp/admin-client.ts`, `xmpp/config.ts:14`). Trailing slashes are stripped (`xmpp/config.ts:46-48`, `56`). | Not a secret, but in production it should be `https://`. |
| `EJABBERD_ADMIN_JID` | Yes | — | Bare JID of the ejabberd admin account the server logs in as. Must match `EJABBERD_ADMIN_JID` in `infra/.env` so the container registers the same account on first boot (`infra/docker-compose.dev.yml`). | **Treat as semi-secret** — knowing the admin JID plus its password is enough to call the admin API. |
| `EJABBERD_ADMIN_PASSWORD` | Yes | — | Password for the admin account above. Must match `EJABBERD_ADMIN_PASSWORD` in `infra/.env` so the container's `jwt-entrypoint.sh` registers (or updates) the admin account with it quietly, never printing it (`infra/docker-compose.dev.yml`). | **Secret.** Never log. |
| `XMPP_DOMAIN` | No | `zilar.localhost` | XMPP domain users are registered on. Lowercase host name, `1-253` characters (`xmpp/config.ts:5-9`, `17`). | Not a secret. |
| `XMPP_MUC_DOMAIN` | No | `rooms.zilar.localhost` | MUC (group chat) domain. Same shape rules as `XMPP_DOMAIN` (`xmpp/config.ts:18`). | Not a secret. |
| `XMPP_WS_PUBLIC_URL` | No | `ws://127.0.0.1:5280/ws` | Public WebSocket URL clients connect to. Must be `ws://` or `wss://` (`xmpp/config.ts:19`). | Not a secret. In production use `wss://`. |
| `ZILAR_XMPP_JWT_SECRET` | Yes | — | HS256 secret the server signs short-lived XMPP login JWTs with. Must be at least 32 characters and match `ZILAR_XMPP_JWT_SECRET` in `infra/.env` so the ejabberd container's `jwt-entrypoint.sh` derives the same JWK (`infra/docker-compose.dev.yml:63`). | **Secret.** Generate with `openssl rand -base64 48`. Changing it later invalidates every issued token. |
| `XMPP_ARCHIVE_DATABASE_URL` | No | — | Connection string for the read-only `zilar_archive` role on the ejabberd MAM database (`search/service.ts`, `search/routes.ts`). Absent → `GET /api/search` answers 501 `search_unavailable` and the web hides the feature. The pool is separate from the app pool (`max` 3) with a 3 s statement timeout. | **Secret.** Password goes here. See "Message search" below. |

### Message search (T-0117)

Search reads the ejabberd `archive` table through a **read-only** role. Create it:

1. Add `ZILAR_ARCHIVE_DB_PASSWORD=CHANGE_ME` to `infra/.env` (git-ignored; generate with `openssl rand -base64 32`).
2. `infra/postgres/init/20-search-reader.sql` creates the `zilar_archive` role on first start of an empty data volume, grants it `CONNECT` + `USAGE ON SCHEMA public`, grants `SELECT` on `archive` when the table already exists, and sets `ALTER DEFAULT PRIVILEGES FOR ROLE ejabberd … GRANT SELECT ON TABLES TO zilar_archive` so tables ejabberd creates later (including its `archive`) are readable too.
3. On an existing volume, apply the same grants manually: `GRANT SELECT ON archive TO zilar_archive;` (plus the `ALTER DEFAULT PRIVILEGES` line above if the role predates it).
4. Point the server at it: `XMPP_ARCHIVE_DATABASE_URL=postgres://zilar_archive:CHANGE_ME@127.0.0.1:5432/ejabberd` (in `apps/server/.env`, git-ignored).

The shape of the table and the query design are in `docs/SEARCH_NOTES.md` (≤ 60 lines). The query text is never logged or stored: the route logs only the result count and duration.

### Smarter matching (T-0142)

No database extension is used. The first pass folds accents/case (`translate(lower(txt), …)`) and matches the last query term as a prefix (`to_tsquery` with `:*`, built from sanitized tokens). When it returns fewer rows than the page limit, a bounded second pass (same scope, cutoff, cap, newest first — never for queries shorter than 3 characters) scores candidates in code with Damerau-Levenshtein distance (terms of 1–3 chars: exact/prefix only; 4–7 chars: distance 1; 8+ chars: distance 2). Each result carries an optional `match: 'exact' | 'fuzzy'` field both clients ignore.

### AI (LiteLLM) and provider-key encryption

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `LITELLM_BASE_URL` | No | none → falls back to `http://127.0.0.1:4000` (`ai/litellm-client.ts:6`) | Base URL for LiteLLM admin calls and the gateway's LLM calls (`ai/integration.ts:19`, `agents/gateway.ts:283`). | Not a secret. The default lives in the AI module, not the schema, so an absent variable does not change the parsed config (`ai/litellm-client.ts:4-6`). |
| `LITELLM_MASTER_KEY` | No | — | Bearer token for the LiteLLM admin API (`ai/integration.ts:18`, `ai/litellm-client.ts`). Absent → the AI and gateway code refuses to call LiteLLM; every AI route answers 503 (`app.ts:210-227`). | **Secret.** |
| `ZILAR_KEY_ENCRYPTION_KEY` | No | — | Envelope-encryption master key for provider keys stored in `provider_connections` (`connections/crypto.ts:1-103`). Must be at least 32 characters when set (`config.ts:61`). Absent → `provider_connections` and AI write routes answer 503 (`app.ts:184-203`, `app.ts:204-227`); the cipher is what unlocks AI access to LiteLLM. | **Secret.** Generate with `openssl rand -base64 48`. Changing it makes every stored provider key undecryptable. |

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
| `AGENT_GATEWAY_ENABLED` | No | `false` | Off by default; set to `'true'` to enable (`config.ts:65-68`). Wires the agent gateway into `index.ts` and starts every active AI over XMPP (`agents/gateway.ts:1353-1364`). Needs `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY` and `ZILAR_KEY_ENCRYPTION_KEY` to do anything useful — without any of those the gateway logs `agent gateway needs LiteLLM and the key cipher; staying off` and stays off (`agents/gateway.ts:1361-1364`). | Not a secret. |
| `RUNNER_HUB_ENABLED` | No | `false` | Off by default; set to `'true'` to enable the tunnel for approved runners (`config.ts:73-76`). When on, the server binds `RUNNER_HUB_PORT` to `127.0.0.1` (`machines/hub.ts:200-344`) and validates that the gateway URL is `http://` (`machines/hub.ts:356-365`). A misconfigured URL exits before the HTTP server starts (`index.ts:56-59`). | Not a secret. |
| `RUNNER_HUB_PORT` | No | `3189` | TCP port the runner hub tunnel binds to. Integer in `[1, 65535]` (`config.ts:77-84`). | Not a secret. |
| `ROUTINES_ENABLED` | No | `false` | Off by default; set to `'true'` to enable the routines scheduler (`routines/scheduler.ts`, `config.ts`). When on, the server fires due routines every 30 s through the configured tool runner and posts the output as the AI (`index.ts`). With the flag on but no tool runner configured, the scheduler logs one warning and stays off. | Not a secret. |
| `TOOLS_ENABLED` | No | `false` | Off by default; set to `'true'` to enable AI-built tools and routines (`tools/adapters.ts`, `config.ts`). When on, the server builds the real sandbox runner (`sandbox/run-tool.ts` with default limits), registers the `tool.*` / `routine.*` action adapters in the action registry (next to the demo adapter when it is on), passes the same runner to the tools routes and the routines scheduler, and registers `routine.schedule` only when `ROUTINES_ENABLED` is also `true`. With the flag off no adapter is registered and manual runs answer 501 `runner_unavailable`. **Warning: tool code written by models runs on this server in the sandbox — see `docs/TOOL_SANDBOX.md`.** | Not a secret. |
| `WEB_TOOLS_ENABLED` | No | `false` | Off by default; set to `'true'` to enable the gateway-level web tools for AIs (`web-tools/adapters.ts`, `config.ts`). When on, the server registers `web.fetch`, `web.wikipedia`, `web.price`, `web.feed` and a best-effort `web.search` in the action registry (next to the demo and tool adapters when they are on). Keyless, no account: reading public pages, Wikipedia summaries, RSS/Atom feeds and market prices (crypto, stocks, indexes, gold) work with nothing to sign up for. With the flag off no `web.*` adapter is registered. **Warning: these tools make outbound requests from this server — see `docs/TOOL_SANDBOX.md` for the network guard (DNS pinned, private addresses refused, no redirects, 10 s timeout, 2 MiB cap).** | Not a secret. |
| `LISTENER_ENABLED` | No | `false` | Off by default; set to `'true'` to turn on the group listener (`agents/gateway.ts`, `agents/listener/score.ts`, `config.ts`). When on, and a group's owner or admin has switched the listener on in the group panel, the gateway watches human talk that mentions no AI. After a 20 s pause, or every 12 messages, it makes one scoring call, and AIs above the group's eagerness threshold (quiet 0.8, normal 0.6, eager 0.4) post "<name> is looking at this" and answer. The listener needs `LISTENER_MODEL` and `LITELLM_MASTER_KEY` as well; if either is missing it logs one warning and stays off. While this flag is off, the group switch shows "Turned off on this server". | Not a secret. |
| `LISTENER_MODEL` | With `LISTENER_ENABLED` | — | The LiteLLM model name the listener's scoring call uses (`config.ts`, `index.ts`). **The server pays for it,** through `LITELLM_MASTER_KEY`, not the AIs' owners. Pick a small, cheap model: each call only scores who should answer. | Not a secret. |
| `WEB_SEARCH_PROVIDER` | No | `duckduckgo-html` | The search backend behind the port (`web-tools/search.ts`, `config.ts`). `duckduckgo-html` parses one DuckDuckGo HTML result page per call and may be blocked or change its markup at any time (then `web.search` honestly answers `search unavailable right now`); `none` unregisters `web.search`. A real provider (SearXNG, Exa) can later be added as one adapter behind the same port. Junk values fail startup. | Not a secret. |
| `AGENT_TOOL_MAX_ROUNDS` | No | `1` with tools off, `6` with tools on | How many tool rounds one AI turn may run (integer `1`–`10`; `config.ts`, `agents/reply.ts`). Round 1 is the first model call with tools; every round that asks for tool calls has them executed and fed back, until a round answers in text or the caps stop the loop. Per-turn caps: 120 s wall clock, 12 tool calls total, 8 KB per tool result (still inside `<untrusted-tool-output>`); a repeated identical call gets "already done". When the rounds run out the last call is tool-free so the AI must answer in text. Set explicitly to force either value whatever `TOOLS_ENABLED` says. | Not a secret. |

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
- `ZILAR_KEY_ENCRYPTION_KEY` unset → `cipher === undefined`, same outcome (`agents/gateway.ts:1361-1364`, `connections/crypto.ts:98-103`).

The flag gates only the gateway's XMPP connections. The AI HTTP routes depend on LiteLLM and the key cipher instead: without `LITELLM_MASTER_KEY` or `ZILAR_KEY_ENCRYPTION_KEY` the AI write routes answer 503 `ais_unavailable` and the connections routes answer 503 `connections_unavailable` (`app.ts:185`, `app.ts:207`), whatever the flag says.

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
Web push through ejabberd's `mod_push` plus an installable web app (PWA). Off by default (`PUSH_ENABLED=false`); when on, the server runs as an XEP-0114 component that receives XEP-0357 publish IQs and fans them out to browsers with `web-push` (VAPID + RFC 8291: the payload is encrypted end to end, relays see ciphertext). The component dials the `ejabberd_service` listener on port 5347 (`PUSH_COMPONENT_PORT`) from inside the Compose network (Docker) or over loopback (bare metal); no host port is published for it in production.

The literal-host rule (learned live 2026-10-01): ejabberd does NOT expand macros in map keys, so the `ejabberd_service` host is always written literally as `push.<domain>` and the key must equal `PUSH_COMPONENT_JID` in the server env. Everything else (the secret) stays a macro. Each deploy path writes the literal host its own way: the dev stack (`infra/`) hardcodes `push.zilar.localhost`, the Docker image generates `push.<ZILAR_DOMAIN>` at container start (`deploy/ejabberd/push-entrypoint.sh`), and bare metal writes it out by hand (`deploy/baremetal/ejabberd.yml`).

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `PUSH_ENABLED` | No | `false` | `'true'` starts the push component and enables the `/api/push/*` routes. With anything else the routes answer 404 and no component starts. | Not a secret. |
| `PUSH_VAPID_PUBLIC_KEY` / `PUSH_VAPID_PRIVATE_KEY` | With push | — | VAPID key pair the browsers subscribe against. Generate with `web-push generate-vapid-keys` (one-off; needs the `web-push` CLI, not a dependency) — or take the pair `./zilar init` generates with openssl (same curve and encodings, verified against the library). | **Secrets** (the private key; the public key is served to logged-in browsers at `GET /api/push/config`). |
| `PUSH_VAPID_SUBJECT` | With push | — | Contact URI for the push services, e.g. `mailto:admin@example.com`. | Not a secret. |
| `PUSH_COMPONENT_JID` | With push | — | The component domain, e.g. `push.zilar.localhost`. Must equal the host key written literally under the `ejabberd_service` listener in `infra/ejabberd/ejabberd.yml` (ejabberd does not expand macros in map keys). | Not a secret. |
| `PUSH_COMPONENT_SECRET` | With push | — | Shared secret with ejabberd's `ejabberd_service` listener. Must equal the container's `EJABBERD_MACRO_PUSH_COMPONENT_SECRET`. | **Secret.** Generate with `openssl rand -base64 32`. |
| `PUSH_COMPONENT_PORT` | No | `5347` | Component listener port. Integer in `[1, 65535]`. | Not a secret. Must match the `port` in `infra/ejabberd/ejabberd.yml`. |
| `PUSH_STORAGE_KEY` | With push | — | Seals browser subscription keys at rest (AES-256-GCM envelope). At least 32 characters. Rotating it orphans existing rows (the component drops undecryptable devices instead of sending). | **Secret.** Generate with `openssl rand -base64 48`. |
| `XMPP_ARCHIVE_DATABASE_URL` | With push | — | Same read-only archive reader as message search (see "Message search" above). Push **requires** it: without the archive the component cannot resolve who/where and drops notifications instead of guessing. The server refuses to start the component without it. | **Secret.** |

Wiring a new install (all three must agree, then restart ejabberd so the listener and `mod_push_keepalive` take effect):

Dev stack:

1. `infra/ejabberd/ejabberd.yml` ships the `ejabberd_service` listener on port 5347 (all container interfaces; the compose file publishes it on `127.0.0.1` only) with the host written literally (`push.zilar.localhost`) and the `PUSH_COMPONENT_SECRET` macro (`CHANGE_ME` default, never committed).
2. `infra/docker-compose.dev.yml` already passes `EJABBERD_MACRO_PUSH_COMPONENT_SECRET: ${PUSH_COMPONENT_SECRET:-CHANGE_ME_PUSH_COMPONENT_SECRET}` to ejabberd and publishes `127.0.0.1:5347`. Set `PUSH_COMPONENT_SECRET` in `infra/.env` (git-ignored) to the same value as the server's `PUSH_COMPONENT_SECRET`.
3. `apps/server/.env` (git-ignored) needs the seven `PUSH_*` variables above plus `XMPP_ARCHIVE_DATABASE_URL`.

Production install (Docker Compose, `./zilar init` does all of this):

1. `deploy/ejabberd/ejabberd.yml` ships the same `ejabberd_service` listener (all container interfaces, no host port published — the server is on the same network) plus `mod_push` (`include_sender`/`include_body` off) and `mod_push_keepalive`. The host key is generated at container start from `ZILAR_DOMAIN` by `deploy/ejabberd/push-entrypoint.sh` (called from `jwt-entrypoint.sh`); the secret stays the `EJABBERD_MACRO_PUSH_COMPONENT_SECRET` macro. `deploy/docker-compose.yml` passes both `EJABBERD_MACRO_PUSH_COMPONENT_SECRET` and `ZILAR_DOMAIN` to ejabberd, and derives the server's `PUSH_COMPONENT_JID` as `push.${ZILAR_DOMAIN}` — so all three agree with no manual step.
2. The server gets the seven `PUSH_*` variables from `deploy/.env` (written by `init`: VAPID pair, `PUSH_VAPID_SUBJECT`, component JID/secret, storage key) plus the already-required `XMPP_ARCHIVE_DATABASE_URL`. With `--no-push` neither the component JID nor the keys are written — the compose files derive `push.<domain>` from `ZILAR_DOMAIN` themselves, so an absent JID line is the correct off state, and `doctor` does not flag it. Missing push lines otherwise mean push off (`PUSH_ENABLED=false`); never write an empty value (`KEY=` renders as an empty string and the schema rejects it at startup — leave the line out instead).
3. `./zilar doctor` checks the pieces (keys present with the right shape, JID matches the domain, and — when the stack runs — that ejabberd accepted the component handshake, which proves the secret and the host both agree). `backup`/`restore` carry `deploy/.env`, so `PUSH_STORAGE_KEY` survives (losing it orphans every device).

Coolify: same variables through the Coolify env UI (`SERVICE_PASSWORD_PUSH_COMPONENT` feeds both secret lines; `PUSH_COMPONENT_JID` and `ZILAR_DOMAIN` derive from `XMPP_DOMAIN` — all three must name the same domain). Bare metal: write the listener host and password out literally in `deploy/baremetal/ejabberd.yml` and set the same values in `/etc/zilar/zilar.env` (see `docs/INSTALL_BARE_METAL.md` §3-§4); the component dials `127.0.0.1:5347`.

Behaviour: one push node per device (`POST /api/push/subscriptions` returns the `{ jid, node }` the browser enables over its own XMPP session — ejabberd requires the enable IQ from the user's session, there is no admin shortcut). A re-registration (same endpoint, new subscription) replaces the old device row — scoped by user id AND endpoint in the same transaction — and the stale enable-pair behind it is dropped as a backstop (the browser normally disables the old pair itself; publishes to a leftover pair drop as `unknown-device`). Every topic/group room is created with `allow_subscription: true` (older rooms are reconciled with `change_room_option` at component start); members holding a push device are subscribed to the rooms they may see and unsubscribed when they lose access. At send time the component reads the newest archived message, re-checks mute (topics inherit the group General mute) and private-topic visibility with `canSeeTopic`, and sends `{ title: "Ana in Group › Topic", body: first 120 chars when the user's previews setting is on }` capped at 3000 bytes. Expired endpoints (404/410) delete the row; every publish IQ is answered `result` even when dropped. Devices with no send for 90 days list as `inactive`. `POST /api/push/test` (5 per 10 min per user) sends a fixed "Push notifications work on this device." payload. Logs carry ids only — never message text or endpoint URLs.

### Group invite links (T-0115)

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `WEB_BASE_URL` | No | `http://localhost:5173` | Web base URL baked into shareable group join links (`POST /api/groups/:id/invite-links` answers `{ id, token, url }` with `url = ${WEB_BASE_URL}/j/<token>`; `config.ts`). | Not a secret. Must be the URL people open in a browser, or copied links 404. |
| `TRUSTED_PROXY_HOPS` | No | `0` | How many right-most `x-forwarded-for` hops to trust when resolving the client IP for the per-IP invite-link join limiter (integer `0`–`5`; `config.ts`). `0` ignores proxy headers and uses the socket address. Set to `1` when the server sits behind one proxy (e.g. Caddy): the client IP is then the address the proxy appended on the right, while a forged left-most entry is ignored. Only the join limiter reads it. | Not a secret. Set it to the number of proxies in front of the server, or every user shares one IP budget. |

Shareable links join a **group** as `member` (public topics come with joining; private topics are never joined by link). Only the SHA-256 hash of the 32-byte token is stored — the token is shown once at creation and never logged or audited; the admin list carries the last-4 hint, label, uses and state, never tokens. At most 10 active links per group. Joining consumes one use with a conditional update (not revoked, not expired, under the cap), so two racing joins can never exceed `max_uses`. Unknown/expired/revoked/exhausted links answer the same 404 `invalid_link` (no leak of which); a full group answers 409 `group_full`. Join attempts are rate limited (20/hour/user, 60/hour/IP, in-memory per process, like the other caps in `rate-limit.ts`); behind a proxy set `TRUSTED_PROXY_HOPS` (above) so the per-IP budget is per client, not per proxy. Audited as `group.link_created`, `group.link_revoked`, `group.joined_by_link` (link id + hint only, never the token). The web `/j/<token>` page sends a signed-out visitor to the login with `next=/j/<token>` and returns them after sign-in. Invite-only sign-up is unchanged: a person without an account still needs a sign-up invite first.

### Stickers (T-0120)
| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `STICKER_STORAGE_DIR` | No | `./data/stickers` | Directory sticker files are stored under. File names are `<uuid>.<ext>` (never user input). A relative value resolves against the server package root (`apps/server`), not the process cwd — the Dockerfile starts from `/app` while a developer may start from the repo root, and both land on the same directory. The root is found by walking up from the service file to the `package.json` named `@zilar/server`, so a build step that changes the output shape (e.g. `src/` → `dist/`) resolves to the same root instead of moving the dir. Absolute paths pass through unchanged. | Not a secret. Must be writable at startup — the server creates it when missing and exits with `STICKER_STORAGE_DIR (<dir>) is not writable` otherwise (`index.ts`, `startup.ts`). When the directory is created at startup, the server logs ONE warning line with the resolved path (`STICKER_STORAGE_DIR did not exist; created <dir>`); when the resolved directory holds no sticker files while the database has sticker rows, it logs ONE more warning line naming the resolved path — the "a build step moved the base" case, where a relative path resolved against an unexpected root and previously uploaded files are silently unreachable. In production the server also warns once per storage dir when it sits on the container layer (no mount: files lost on replace) and when `GIF_PROVIDER` is set without `GIF_API_KEY` (GIF search stays 501). |

Uploaded stickers are validated by magic bytes (PNG or WebP only, ≤ 512 KiB, ≤ 512 × 512 px) and served with `Content-Type` from the stored mime, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Cache-Control: public, max-age=31536000, immutable` and `Content-Security-Policy: default-src 'none'; sandbox`. Deleting a pack removes its files; messages already sent keep their sticker URL, which no longer loads a sticker. Uploads are rate limited to 60/hour/user (in-memory, per process, like the other caps in `rate-limit.ts`). Audited as `sticker_pack.created` / `sticker_pack.deleted` (pack id only).

Docker/Coolify note: the production compose files already mount the `sticker-data` volume at `/data/stickers` (`STICKER_STORAGE_DIR` is fixed there); on other setups mount a persistent absolute path, or the files are lost when the container is replaced. The directory is git-ignored (`data/` is covered by the `*.log`-adjacent local-data rules; add an explicit `data/` entry if one is missing) and never backed up by the database dump — back it up with the volume.

### Avatars and chat backgrounds (T-0165, T-0460)

Both directories follow the same rules as `STICKER_STORAGE_DIR`: file names are `<uuid>.<ext>` (never user input), a relative value resolves against the server package root, and the server creates the directory when missing or exits with `<VAR> (<dir>) is not writable` otherwise (`index.ts`, `startup.ts`). Images are validated by magic bytes (PNG or WebP) before they are written.

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `AVATAR_STORAGE_DIR` | No | `./data/avatars` | Directory profile pictures (people, AIs, groups and channels) are stored under (`config.ts:72`). | Not a secret. In production the compose files fix it at `/data/avatars` on the `avatar-data` volume (`deploy/docker-compose.yml:148`). |
| `BACKGROUND_STORAGE_DIR` | No | `./data/backgrounds` | Directory uploaded chat background images are stored under (`config.ts:77`). | Not a secret. The production stack sets it to `/data/avatars/backgrounds` (`deploy/docker-compose.yml:153`), inside the existing `avatar-data` volume, so it adds no volume and rides `avatars.tgz` in backups. |

An avatar is 256 × 256 WebP or PNG, ≤ 256 KB, cropped in the browser. A chat background is either a preset token (no file) or one of the owner's uploaded images; a group's own background is set by its owner or admins and is readable by members. Upload, serve and delete live under `/api/avatars`; upload, list, serve and delete under `/api/backgrounds`. An unknown or foreign id answers the same 404. See "File storage, backups, quotas, disk" below for where the files live and what backs them up.

### File storage, backups, quotas, disk (T-0151)

Where each kind of file lives, and what covers it:

| Kind | Where it lives | Backed up by | Notes |
|---|---|---|---|
| Attachments (XEP-0363) | ejabberd upload docroot: `/opt/ejabberd/upload` in the container (volume `ejabberd-uploads`); `/var/lib/ejabberd/upload` on bare metal | `./zilar backup` archives the uploads volume (`uploads.tgz`); bare metal: copy the docroot dir (§7) | Per-file cap `max_size` 50 MiB; per-user quotas below |
| Stickers | `STICKER_STORAGE_DIR`, fixed at `/data/stickers` in both compose files (volume `sticker-data`); `/var/lib/zilar/stickers` on bare metal | `./zilar backup` archives the sticker volume (`stickers.tgz`); bare metal: copy the dir (§7) | Never relative in production: a relative path resolves against the server package root and a moved base silently orphans files (see Stickers above) |
| Avatars | `AVATAR_STORAGE_DIR`, fixed at `/data/avatars` in both compose files (volume `avatar-data`) | `./zilar backup` archives the avatar volume (`avatars.tgz`) | Profile pictures for people, AIs, groups and channels; never relative in production (see Avatars and chat backgrounds above) |
| Background wallpapers | `BACKGROUND_STORAGE_DIR`, fixed at `/data/avatars/backgrounds` in the production stack, inside the `avatar-data` volume | Covered by `avatars.tgz` (the backup archives the whole avatars directory) | Uploaded chat background images; presets are tokens and need no file |
| GIFs | Not stored: the server proxies provider media (`/api/gifs/media/:token`) and a sent GIF becomes a normal attachment | As attachments, once sent | Needs `GIF_PROVIDER` + `GIF_API_KEY` |
| Voice | Not stored separately: the client uploads the recording through XEP-0363 and sends it as an attachment | As attachments, once sent | Recording, waveform, AAC conversion and playback are in the voice engine (T-0154, T-0176) |

Upload quotas (ejabberd `mod_http_upload_quota`, stock module, always on): each user's files under the upload docroot count against `soft_upload_quota` (default 2048 MiB) / `hard_upload_quota` (default 4096 MiB) in `deploy/ejabberd/ejabberd.yml` (`shaper_rules`, plain numbers). Past the hard quota ejabberd deletes the user's oldest files until usage is back at the soft quota; `max_days` is unset (infinity), so files never age out without the owner. Retune by editing the two shaper numbers in `deploy/ejabberd/ejabberd.yml` (shaper keys are literal — macros do not expand there, verified live against the stock image), so they are not environment settings and the ejabberd image must be rebuilt for a change to apply. Bare metal carries the same 2048/4096 rules literally in `deploy/baremetal/ejabberd.yml`.

Disk: `./zilar doctor` reports free space of the Docker data filesystem (warns at 80% used, fails at 95%, in plain words) and checks the sticker directory is on a mounted volume, not the container layer. The thresholds are fixed; `ZILAR_DOCTOR_DISK_USED_PCT` injects a value for tests only.

When to consider S3: ejabberd's upload module writes only to local disk, and the sticker store is a local directory too. One server instance with the volumes above is fine for hundreds of users; consider S3-compatible object storage (ejabberd ships `mod_s3_upload`) when you run more than one server instance (local disks disagree) or growth outruns one disk. That migration is out of scope here — no S3 code ships in this task.

### GIFs (T-0122)

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `GIF_PROVIDER` | No | — (feature off) | Picks the GIF search adapter (`giphy` today; a second adapter can be added behind the same port later). Unset = every GIF route answers 501 `gifs_unavailable` and the web hides the tab. Set without `GIF_API_KEY` = the server logs ONE startup warning (half-configured; routes still 501). | Not a secret. |
| `GIF_API_KEY` | With `GIF_PROVIDER` | — | API key for the GIF provider. The server sends it to the provider; it is never logged or returned. | **Secret.** Put it in `infra/.env` as `GIF_API_KEY`. |
| `GIF_RATING` | No | `pg-13` | Rating filter sent with provider search/trending (`g` \| `pg` \| `pg-13` \| `r`). | Not a secret. |

The browser never contacts the provider: `GET /api/gifs/search?q=&pos=` and `GET /api/gifs/trending?pos=` run server-side (30 requests/minute/user, in-memory per process; the media proxy `GET /api/gifs/media/:token` has its own 600 requests/minute/user budget because one page fans out to 25 preview fetches), and results carry no provider URLs — each media URL is replaced by an opaque HMAC-signed `mediaToken` (15-minute expiry, bound to the exact URL and the user id). `GET /api/gifs/media/:token` verifies the token, then streams the media with the SSRF guard (https only, documented media hosts only, resolve-then-pin with private/loopback/link-local refused, no redirects, 8 MiB cap, 10 s timeout, only `image/gif`, `image/webp`, `video/mp4`, `video/webm`), rebuilding response headers from scratch plus `Cache-Control: private, max-age=86400` and `nosniff`. Search text is never logged or audited (counts and durations only). A sent GIF is stored as a normal attachment (XEP-0363 upload + `attachment` payload), so it keeps working if the provider disappears.

### Telegram sticker import (T-0123)

| Variable | Required? | Default | What it does | Notes |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | No | — (feature off) | Token of a Telegram bot (Julio creates one with @BotFather) that may call `getStickerSet`/`getFile` for public packs. Unset = `POST /api/sticker-packs/import/telegram` answers 501 `import_unavailable` and the web hides the entry. | **Secret.** Put it in `infra/.env` as `TELEGRAM_BOT_TOKEN` (never in chat, never in a committed file). Never logged or returned (`logger.ts` redacts it; the client scrubs it from every error). |

Paste a pack link (`https://t.me/addstickers/<name>`), a `tg://addstickers?set=<name>` link or the bare pack name into Settings → Stickers → Import from Telegram. The server fetches the pack (only `https://api.telegram.org` is ever contacted, no redirects, 10 s timeout, 1 MiB cap per file, 256 KiB cap per JSON method envelope), downloads each static sticker, and validates every file with the same magic-byte probe as uploads. At most 200 stickers are considered and 120 imported (the pack limit); animated (`.tgs`) and video (`.webm`) stickers are skipped and counted ("3 animated stickers were skipped"); custom emoji sets are refused. The import runs inside a 30 s request budget and reports `partial: true` when the budget ran out — running it again fills the gaps (stickers are matched by Telegram's `file_unique_id`, stored in `stickers.source_id`), never duplicates. 3 imports per hour per user (in-memory, per process). Audited as `sticker_pack.imported` (pack id and counts only).

Copyright stance (decision D27): sticker art belongs to its creators. Imported packs are for **personal use**: forced `visibility = 'private'`, `imported_from = 'telegram:<name>'`, a visible attribution ("Imported from Telegram: <pack title>"), and they can never be switched to `server` visibility. The UI says this next to the form and in the result.

### Channels (T-0124)

Channels add no env vars. A channel is a group with `kind = 'channel'` and an optional `description` (≤ 300, shown in the panel): one broadcast feed (its General topic — no more topics, `POST /api/groups/:id/topics` answers 400 `channel_has_no_topics`), where only owner/admins post and members subscribe. The posting rule is enforced by the room, not the UI: the feed room is created with `create_room_with_opts` carrying `moderated: true` **and** `members_by_default: false` (plus `members_only`, `persistent`, `mam`, non-`anonymous`), so subscribers (affiliation `member`) join as visitors — they read but cannot post — while affiliations `owner`/`admin` carry voice. The server keeps the mapping in sync — promotions/demotions (`PUT /api/groups/:id/members/:userId/role`, owner only) set the affiliation at once, and every later join/leave re-sync preserves admin voice (`desiredMembers` in `topics/rooms.ts`). Demoting or removing the last admin answers 409 `channel_needs_admin`, so the feed never falls silent. Reactions are messages in XMPP, so subscribers in a moderated room cannot react either: channels stay read-only for subscribers (mute via the T-0113 pref). The subscriber audience is visible to admins only (`GET /api/groups/:id` hides it from subscribers; `GET /api/groups/:id/members` answers the full audience for admins, the owner/admins slice for subscribers — who posts is public, every admin post carries its name — and 404 for strangers); the chat list carries `chatKind: 'channel'` plus `subscriberCount` and `description`. Invite links join channels as subscribers ("Join channel" wording via `kind` in the join preview). Promotions and demotions are audited as `group.role_changed` (group id, user ids and old/new roles only — never names). An AI posts in the feed only while its owner is a channel admin (affiliation `admin` through the same voice mapping; otherwise a voiceless `member`); AIs never see the audience list.

## 4. Database

### How migrations run

Migrations run **at startup**, not on demand. `index.ts` registers the `effect/sql` runtime for the database and then calls `runMigrations(db)`, which runs `migrateSql` (`effect/sql.ts`): each committed `apps/server/drizzle/NNNN_name.sql` file runs in its own transaction, in file order, and is journaled in `effect_sql_migrations`. A database that drizzle migrated before the switch is adopted once, so the committed history is not re-run. If a migration fails, the server never reaches `serve()`.

For an out-of-band migration run (e.g. against a read replica during a deploy):

```bash
pnpm --filter @zilar/server db:migrate
```

The command is defined at `apps/server/package.json:12` and runs `tsx --env-file-if-exists=.env src/db/migrate-cli.ts`, which loads the same config schema and exits non-zero on failure.

A new migration is a hand-written `NNNN_name.sql` file in `apps/server/drizzle/`, numbered after the highest one there. Put `--> statement-breakpoint` between statements, because the loader runs each part on its own. Every new migration must update `db/rows.ts` to match and add a test.

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

- `200` + `{ ok: true, name: 'zilar-server', version: serverVersion, protocolVersion, db: 'ok' }` when the ping resolves.
- `503` + `{ ok: false, name: 'zilar-server', version: serverVersion, protocolVersion, db: 'down' }` when it does not.

The 503 is the only signal a load balancer should treat as unhealthy. `version` comes from `apps/server/package.json` (`version.ts:1-13`); `protocolVersion` from `@zilar/protocol` (`app.ts:6`).

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

- `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY` and `ZILAR_KEY_ENCRYPTION_KEY` are in `config.ts` (`config.ts:49-61`) but **not** listed in `apps/server/.env.example` (the example ends at `AGENT_GATEWAY_ENABLED`).
- `RUNNER_HUB_ENABLED` and `RUNNER_HUB_PORT` are in `config.ts` (`config.ts:73-84`) but **not** in `apps/server/.env.example`.
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_APP_INSTALLATION_ID` are in `config.ts` (`config.ts:53-55`) but **not** in `apps/server/.env.example` (the App config is intentionally gated behind all-or-nothing validation; not listing them in the example is a UX miss).
- `EJABBERD_API_URL`, `XMPP_DOMAIN`, `XMPP_MUC_DOMAIN` and `XMPP_WS_PUBLIC_URL` are in both `apps/server/.env.example` and `xmpp/config.ts` with the same defaults — no mismatch, mentioned for completeness.

## Open questions

- Several env vars appear only in test files (`apps/server/src/agents/integration.test.ts`, `apps/server/src/ais/integration.test.ts`, `apps/server/src/connections/integration.test.ts`, `apps/server/src/voice/integration.test.ts`, `apps/server/src/ai/integration.ts`): `ZILAR_AGENT_INTEGRATION`, `ZILAR_AIS_INTEGRATION`, `ZILAR_AI_MODELS_INTEGRATION`, `ZILAR_VOICE_INTEGRATION`, `ZILAR_CONNECTIONS_INTEGRATION`, `ZILAR_LITELLM_INTEGRATION`, plus the matching `*_URL` and `XMPP_WS_URL` variants. Each is gated by `=== '1'` and only checked in tests, so it is configuration of the test suite, not the server. Listing them here would be misleading; the live server never reads them.
- The web app reads one env var of its own: `ZILAR_API_URL` in `apps/web/vite.config.ts:16` (default `http://localhost:3000`). It is read by Vite, not by `@zilar`, but it has to agree with `PORT` on the server or `/api` 404s. Not documented in `apps/web/.env.example` (there is no web `.env.example` file yet).
- The runner hub accepts a `gatewayUrl` argument whose default comes from `LITELLM_BASE_URL ?? DEFAULT_LITELLM_BASE_URL` (`index.ts:58`, `index.ts:217`). Whether to expose that as a separate `RUNNER_HUB_GATEWAY_URL` env var is **unclear from the code** — the hub will reuse whatever LiteLLM uses, and a misconfigured scheme fails the explicit `http://` check.
- The agent gateway `postToChat` path is reachable only when `AGENT_GATEWAY_ENABLED=true`; whether a separate `ACTION_ANNOUNCER_ENABLED` flag exists to silence the action gateway announcer while keeping the gateway off is **unclear from the code** (the announcer object exists unconditionally in `index.ts:86-142` but `postToChat` is no-op while the gateway is stopped).