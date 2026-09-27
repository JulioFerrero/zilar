---
id: T-0002
title: Local dev infrastructure (docker-compose with Postgres, ejabberd, LiteLLM)
status: todo
milestone: M0
branch: task/T-0002-dev-infra
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0001, T-0012]
estimate: 1–2 days
---

# T-0002: Local dev infrastructure

## Spec (written by Claude, do not edit)

### Goal
One command starts every backing service Galena needs on a developer's Mac, and one command checks that they're healthy:
- **Postgres** with pgvector
- **ejabberd**: XMPP with groups, history, WebSocket, file upload and admin API
- **LiteLLM**: the LLM gateway

Later tasks (the T-0003 ejabberd spike and the T-0007 LiteLLM spike) build on this.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md`:
  - §6.1 ejabberd (the XEP list and configuration)
  - §8.3 LiteLLM
  - §17 (decision D21: **no MinIO**)
  - §23 spikes S1 and S5
- The official docs of the image versions you pin:
  - ejabberd container: `ghcr.io/processone/ejabberd` (its README covers env vars, volumes and first-start admin registration)
  - ejabberd configuration: SQL, `mod_muc`, `mod_mam`, `mod_http_upload`, `mod_http_api`, `mod_push`, WebSocket (`ejabberd_http` with `/ws`)
  - LiteLLM proxy: config.yaml, `master_key`, `database_url`, health endpoints

### Allowed files
- `infra/**`: new folder, for compose file, configs, env example and init scripts
- `packages/devtools/**`: new workspace package `@galena/devtools`, which holds the smoke test (see below)
- Root `package.json`, only to add the `infra:*` scripts below
- `pnpm-lock.yaml`, only the changes `pnpm install` makes for the new package
- `README.md`, only the `## Development` section, to add an "Infrastructure" subsection

**Do not edit `pnpm-workspace.yaml`.** Another worker (T-0011) is editing it in parallel. `packages/devtools` is already covered by the existing `packages/*` glob.

### Requirements

**General**
- Put everything in `infra/docker-compose.dev.yml`, with the Compose project name `galena-dev`.
- **Bind all published ports to `127.0.0.1` only.** Never `0.0.0.0`.
- **Pin every image to an exact version tag.** Pin LiteLLM **by digest** (`image@sha256:…`). **Never use LiteLLM 1.82.7 or 1.82.8**, which were compromised releases.
- Keep data in named volumes. Add a `pnpm infra:reset` that removes them after asking for confirmation.
- Secrets come from `infra/.env`, which is git-ignored. Commit `infra/.env.example` with `CHANGE_ME` placeholders and a comment per variable.

**Postgres**
- Use the `pgvector/pgvector` image (pinned tag, Postgres 17 or newer).
- An init script in `infra/postgres/init/` creates the databases `galena`, `ejabberd` and `litellm`, each with its own user and a password from env.
- Healthcheck with `pg_isready`.

**ejabberd**
- Config in `infra/ejabberd/ejabberd.yml`, mounted read-only.
- XMPP domain `galena.localhost`, groups on `rooms.galena.localhost`.
- **SQL backend:** Postgres, database `ejabberd`, with `default_db: sql`, and the SQL schema created or updated automatically if the pinned version supports it. Otherwise ship the schema init and explain in the Report.
- **Listeners:**
  - 5222 c2s
  - 5280 HTTP, serving:
    - `/ws` (WebSocket)
    - `/upload` (`mod_http_upload`)
    - `/api` (`mod_http_api`)
- `/api` is reachable only from localhost / the Compose network, and requires admin auth.
- **Modules:**
  - `mod_muc`: rooms persistent and members-only by default, MAM enabled
  - `mod_mam`: stored in the DB, default `always`
  - `mod_http_upload`: files on a named volume, 50 MB max
  - `mod_stream_mgmt`, `mod_carbons`, `mod_ping`
  - `mod_push` enabled, with no app server configured yet
  - `mod_http_api`
- **Disabled:**
  - **in-band registration** (no `mod_register`, or registration disabled)
  - **s2s federation** (no s2s listener)
- An admin account `admin@galena.localhost` is created on first start, with its password from env. Use the image's documented mechanism, or a one-shot `ejabberdctl register` in an entrypoint or init step.
- Healthcheck using `ejabberdctl status`.

**LiteLLM**
- Config in `infra/litellm/config.yaml`, with **no real provider keys**. Add a single placeholder model entry that reads its key from an env var, commented to explain how to add real ones.
- `master_key` and `database_url` come from env. Point `database_url` at the `litellm` database.
- Healthcheck using its liveness endpoint.

**Root scripts** (in the root `package.json`)

| Script | Does |
|---|---|
| `infra:up` | `docker compose -f infra/docker-compose.dev.yml --env-file infra/.env up -d --wait` |
| `infra:down` | Stop the containers, keeping the volumes |
| `infra:logs` | Follow the logs |
| `infra:reset` | Remove the volumes, after confirmation |
| `infra:smoke` | Run `pnpm --filter @galena/devtools smoke` |

**Smoke test: `packages/devtools/src/smoke.ts`** (package `@galena/devtools`: private, ESM, with scripts `smoke`, `typecheck` and `test`, and dev dependency `tsx`)
- Exits non-zero, with a clear message per check, if any of these fail:
  1. Postgres accepts a connection for each of the three users. `docker compose exec` with `psql` is fine; no new npm dependency.
  2. ejabberd reports `started` (`ejabberdctl status` through `docker compose exec`).
  3. ejabberd's `/api/status`, or an equivalent admin API command, answers with admin auth.
  4. ejabberd's WebSocket endpoint accepts an XMPP WebSocket handshake. Open a `ws://127.0.0.1:5280/ws` connection with subprotocol `xmpp` and send an `<open/>` frame for `galena.localhost`. The server must answer with an `<open` frame. Use Node 24's built-in `WebSocket`, with no new dependency.
  5. LiteLLM's liveness endpoint returns 200.
- Put small pure helpers (e.g. building the `<open/>` frame, parsing the response) in `packages/devtools/src/smoke-lib.ts`, with **Vitest unit tests** in `smoke-lib.test.ts` next to it. The root `pnpm test` picks them up through Turborepo.
- The compose file path used by the smoke test must be resolved relative to the repo root, so it works from any working directory.

### Acceptance criteria
- [ ] On a clean clone with `infra/.env` copied from `.env.example` (placeholders replaced), `pnpm infra:up` starts all three services, and `--wait` returns once they're healthy.
- [ ] `pnpm infra:smoke` passes all 5 checks.
- [ ] `pnpm infra:down` then `pnpm infra:up` keeps the data. `pnpm infra:reset` wipes it.
- [ ] Only `127.0.0.1` ports are published.
- [ ] Every image is pinned (LiteLLM by digest), and none is a compromised LiteLLM version.
- [ ] In-band registration and s2s are disabled. Verify with `ejabberdctl` or config, and say how in the Report.
- [ ] The existing checks from T-0001 still pass, and the new smoke-lib tests pass.
- [ ] README "Infrastructure" subsection explains setup, the scripts, and where the configs live.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
cp infra/.env.example infra/.env   # then replace every CHANGE_ME with local dev values
pnpm infra:up
pnpm infra:smoke
pnpm infra:down
```

### Out of scope
- Creating user accounts from our server, token or JWT login, rooms from the API. That's T-0003.
- Push relay, TLS certificates, production deployment, Coolify.
- Object storage. Uploads use ejabberd's volume for now, per decision D21.
- Any real LLM API keys.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Image versions and digests pinned
-

### Commands run and real results
- `pnpm infra:smoke`:

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
