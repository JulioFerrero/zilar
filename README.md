# Galena

A self-hosted, Telegram-like chat app where people and AI agents talk together: friends, family, work groups, and groups with your own AIs.

- AIs have their own sandboxed computers ("desks") that run on machines you bring: your Mac, a Linux server, a cheap VPS.
- You bring your own API keys for any provider.
- The platform enforces spending limits and risky-action approvals in code, not in prompts.

> Named after galena, the crystal inside the first radios, the mineral that received messages over the air.

**Status:** design and foundations (milestone M0). No runnable app yet.

## Where to look

| File | What |
|---|---|
| [`docs/PROJECT_PLAN.md`](docs/PROJECT_PLAN.md) | The full design: architecture, MVP scope, roadmap, risks, open questions |
| [`AGENTS.md`](AGENTS.md) | Rules for AI workers (DeepSeek via OpenCode) |
| [`work/README.md`](work/README.md) | How Julio, Claude and the DeepSeek workers collaborate through task files |
| [`work/BOARD.md`](work/BOARD.md) | Current tasks and their status |

## Development

Prerequisites: **Node 24** (see `.nvmrc`) and **pnpm 10** (see `packageManager` in `package.json`; `corepack enable` or `npm install -g pnpm@10`).

```bash
pnpm install
```

Start the dev servers — `@galena/server` on <http://localhost:3000> (`PORT` overrides it), `@galena/web` on <http://localhost:5173>:

```bash
pnpm dev
```

Checks (the same ones CI runs):

```bash
pnpm format:check   # Prettier
pnpm lint           # oxlint
pnpm typecheck      # tsc --noEmit, every package
pnpm test           # Vitest, every package
pnpm build          # Turborepo, builds the web app
```

`pnpm format` rewrites files in place. Apps live in `apps/*`, shared libraries in `packages/*`.

### Infrastructure

The backing services run in Docker Compose (Docker Desktop, or any Docker with Compose v2):

- **Postgres** with pgvector, one database and user each for our server (`galena`), ejabberd (`ejabberd`) and LiteLLM (`litellm`)
- **ejabberd** on the XMPP domain `galena.localhost`, group chats on `rooms.galena.localhost`, admin account `admin@galena.localhost`
- **LiteLLM** as the LLM gateway, with a placeholder model and no real provider keys

`infra/.env` is git-ignored; create it once and replace every `CHANGE_ME`:

```bash
cp infra/.env.example infra/.env
```

`infra/.env` also holds the XMPP login secret (`GALENA_XMPP_JWT_SECRET`, at least 32 random bytes) and the admin JID (`EJABBERD_ADMIN_JID`). The ejabberd container derives its HS256 JWT signing key from the secret on start, and `@galena/server` signs the short-lived tokens clients log in with.

| Script | Does |
|---|---|
| `pnpm infra:up` | Start every service and wait until the healthchecks pass |
| `pnpm infra:down` | Stop the containers, keeping the data volumes |
| `pnpm infra:logs` | Follow the logs |
| `pnpm infra:smoke` | Check Postgres users, ejabberd (status, admin API, WebSocket) and LiteLLM |
| `pnpm xmpp:e2e` | Create users and a members-only room, log in with JWTs and check live messages plus MAM history |
| `pnpm infra:reset` | Delete the data volumes, after confirmation |

Everything binds to `127.0.0.1` only:

| Service | Endpoints | Notes |
|---|---|---|
| Postgres | `127.0.0.1:5432` | pgvector enabled in the `galena` database |
| ejabberd | `127.0.0.1:5222` (c2s), `127.0.0.1:5280` (`/ws`, `/upload`, `/api`) | In-band registration and s2s federation are off |
| LiteLLM | `127.0.0.1:4000` | `master_key` and `database_url` come from `infra/.env` |

Configs live in `infra/`: `docker-compose.dev.yml`, `ejabberd/ejabberd.yml`, `litellm/config.yaml` and `postgres/init/`. Images are pinned to exact tags (LiteLLM by digest); never use LiteLLM 1.82.7 or 1.82.8, those releases were compromised.
