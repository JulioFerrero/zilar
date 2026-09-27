---
id: T-0002
title: Local dev infrastructure (docker-compose with Postgres, ejabberd, LiteLLM)
status: review
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

- `infra/docker-compose.dev.yml` (project `galena-dev`) starts **Postgres (pgvector), ejabberd and LiteLLM**. Every published port is bound to `127.0.0.1`; data lives in three named volumes; all secrets are interpolated from `infra/.env`.
- **Postgres**: `pgvector/pgvector:0.8.6-pg18-trixie` (PostgreSQL 18.6, pgvector 0.8.6). `infra/postgres/init/10-create-databases.sql` creates the users/databases `galena`, `ejabberd`, `litellm` (passwords from env, read with psql `\getenv`) and enables the `vector` extension in `galena`. Healthcheck `pg_isready`. The volume mounts `/var/lib/postgresql` (Postgres 18 keeps PGDATA in `/var/lib/postgresql/18/docker`).
- **ejabberd**: `infra/ejabberd/ejabberd.yml`, mounted read-only. Domain `galena.localhost`, MUC service `rooms.galena.localhost`, SQL backend on the `ejabberd` database with `update_sql_schema: true` (tables created automatically on first start: verified 24 tables). Listeners: 5222 c2s and 5280 HTTP with `/ws` (WebSocket), `/upload` (mod_http_upload, 50 MB, volume) and `/api` (mod_http_api, admin auth). Modules: `mod_muc` (persistent, members-only, MAM), `mod_mam` (SQL, `default: always`), `mod_http_upload`, `mod_stream_mgmt`, `mod_carboncopy`, `mod_ping`, `mod_push`, `mod_http_api`, plus the usual roster/vcard/disco/offline set. Admin `admin@galena.localhost` registered on first start via `REGISTER_ADMIN_PASSWORD` + `EJABBERD_MACRO_ADMIN`. Healthcheck `ejabberdctl status`. **No `mod_register`** and **no s2s listener**, plus `s2s_access: s2s` with `s2s: deny: all`.
- **LiteLLM**: `infra/litellm/config.yaml` with one placeholder model (`openai/placeholder`, key from `os.environ/PLACEHOLDER_API_KEY`), `master_key` and `database_url` from `os.environ`. Healthcheck uses the image's bundled `python` against `/health/liveliness` (the image has no curl/wget). Postgres-backed (Prisma migrated automatically: 78 tables) and verified healthy.
- `infra/.env.example` documents each variable with a `CHANGE_ME` placeholder; `infra/.env` is git-ignored. `infra/reset.mjs` implements `pnpm infra:reset` (asks for `yes`, then `docker compose down --volumes`).
- `packages/devtools` (`@galena/devtools`, private, ESM, scripts `smoke`/`typecheck`/`test`, dev dep `tsx`) with `src/smoke.ts` and pure helpers `src/smoke-lib.ts` + Vitest tests. The smoke test resolves `infra/docker-compose.dev.yml` and `infra/.env` from the repo root via `import.meta.url`, so it works from any cwd. Checks: Postgres for the three users (compose exec + psql), `ejabberdctl status`, `/api/status` with admin Basic auth, a real XMPP WebSocket `<open/>` handshake on `ws://127.0.0.1:5280/ws` (Node's built-in WebSocket), and LiteLLM `/health/liveliness`.
- Root `package.json` got the five `infra:*` scripts; README got its `### Infrastructure` subsection.
- Note: when `/api` is called through the published port, ejabberd logs `Using module :mod_http_api for host 127.0.0.1, but it isn't configured in the configuration file`. It is benign (the Host header is the published address, not the XMPP domain, and the default/virtual-host module is used); the call is still authenticated and authorized, and all three smoke checks that use it pass.

### Files changed

- `infra/docker-compose.dev.yml` (new)
- `infra/.env.example` (new; `infra/.env` created locally for testing and git-ignored)
- `infra/postgres/init/10-create-databases.sql` (new)
- `infra/ejabberd/ejabberd.yml` (new)
- `infra/litellm/config.yaml` (new)
- `infra/reset.mjs` (new)
- `packages/devtools/package.json`, `packages/devtools/tsconfig.json`, `packages/devtools/src/smoke.ts`, `packages/devtools/src/smoke-lib.ts`, `packages/devtools/src/smoke-lib.test.ts` (new)
- `package.json` (only the `infra:*` scripts)
- `pnpm-lock.yaml` (only the new `packages/devtools` importer)
- `README.md` (only `## Development` → `### Infrastructure`)
- `work/T-0002-dev-infra.md` (status + this Report)

### Image versions and digests pinned

| Image | Pin | Notes |
|---|---|---|
| `pgvector/pgvector` | `0.8.6-pg18-trixie` (tag digest `sha256:78bf48b801e792f99e3ac62b5036fd3876e9be48afda16c1e331af1c75ceb2ff`) | PostgreSQL 18.6 + pgvector 0.8.6, amd64/arm64 |
| `ghcr.io/processone/ejabberd` | `26.07` (tag digest `sha256:5aeb0faa39cfe38792c5eea9cc6344ba9ab6c59c708a24e897d6b471882c8497`) | ejabberd 26.7.0 |
| `ghcr.io/berriai/litellm` | `@sha256:87f34979b9f8cb274fac90ca8a4fdda07d8480de22755562a26adeb95ce20d02` | LiteLLM 1.102.1; both tags `1.102.1` and `v1.102.1` resolve to this digest; not 1.82.7/1.82.8 |

### Commands run and real results

- `pnpm install`: PASS. "Scope: all 5 workspace projects … Done". `pnpm-lock.yaml` gained only the `packages/devtools` importer (tsx 4.23.15).
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors … 16 files with 127 rules".
- `pnpm typecheck`: PASS — turbo "4 successful, 4 total" (protocol, server, web, devtools).
- `pnpm test`: PASS — turbo "4 successful, 4 total": devtools 9 tests, protocol 6, server 2, web 3.
- `cp infra/.env.example infra/.env` then filled every `CHANGE_ME` with random local dev values (git-ignored; not shown here).
- `pnpm infra:up`: PASS — Postgres, ejabberd and LiteLLM all reach "Healthy" before `--wait` returns.
- `pnpm infra:smoke`: PASS — all 5 checks:
  `PASS Postgres accepts a connection for the users galena, ejabberd and litellm` / `PASS ejabberd reports "started" (ejabberdctl status)` / `PASS ejabberd answers /api/status with admin auth` / `PASS ejabberd accepts the XMPP WebSocket <open/> handshake` / `PASS LiteLLM liveness endpoint answers 200`.
- `pnpm infra:down` then `pnpm infra:up`: PASS — a marker row created in `galena` before `down` is still there after `up` (`SELECT count(*)` → `1`).
- `printf 'nope\n' | pnpm infra:reset`: PASS — prints "Aborted. Nothing was deleted." and the marker row is still `1`.
- `printf 'yes\n' | pnpm infra:reset` then `pnpm infra:up`: PASS — all volumes removed, services healthy again, marker table gone, `vector` extension present again.
- Port check `docker ps --filter name=galena-dev --format '{{.Names}} | {{.Ports}}'`: only `127.0.0.1:5432`, `127.0.0.1:5222`, `127.0.0.1:5280`, `127.0.0.1:4000` are published. The other ports shown for the ejabberd row (1880, 5269, 5443, …) are the image's `EXPOSE`s, not host bindings.
- In-band registration check: over the WebSocket, after `<open/>`, the server replies with `<stream:features>` containing only SASL mechanisms — no `<register xmlns='http://jabber.org/features/iq-register'/>` feature — and `mod_register` is absent from `infra/ejabberd/ejabberd.yml`. Registration is off.
- s2s check: `netstat -tln` inside the ejabberd container shows listeners on 5222 and 5280 but **not 5269**, the config has no `ejabberd_s2s_in` listener, and `s2s_access: s2s` with `s2s: deny: all` blocks outgoing s2s too.
- SQL auto-schema check: `pg_tables` in `ejabberd` → 24 tables (users, rosterusers, muc_room, archive, …) and in `litellm` → 78 tables, both created automatically.

### Problems, deviations from the spec, open questions

1. **`mod_carbons` (spec) vs. the real module name.** ejabberd 26.07 has no `mod_carbons`; XEP-0280 is `mod_carboncopy` (it is what the image's default config loads). I used `mod_carboncopy`. `mod_carbons` would be an unknown module and stop startup.
2. **Postgres init is a `.sql` file, not the `.sh` "init script".** A shell init script did not work on Docker Desktop: bind mounts are presented as executable, so the postgres entrypoint uses its `if [ -x ]` → exec path, and executing a bind-mounted script fails with `bad interpreter: Permission denied` (verified: executing a script from `/tmp` works, from `/docker-entrypoint-initdb.d` it does not). A `.sql` file is processed by the entrypoint with `psql -f` (no execve) and reads the passwords with psql's `\getenv`. The file is still `infra/postgres/init/`.
3. **`access.allow` is AND-ed, not OR-ed.** The image's default `access: allow: [acl: loopback, acl: admin]` requires *both*, so `/api` from the host (Docker gateway IP) was 403 even with a valid admin login. Following the docs' "admin access" example, `who: access: allow: - acl: admin` now requires admin auth and the network reach is limited by the 127.0.0.1 binding and the Compose network.
4. **`packages/devtools/tsconfig.json` adds `lib: ["DOM", "DOM.Iterable"]`.** The installed `@types/node` does not declare the global `WebSocket` (nor `fetch`) types, and the spec requires Node 24's built-in WebSocket without new dependencies. DOM supplies the WHATWG types; Node 24 supplies both globals at runtime.
5. **LiteLLM healthcheck uses Python.** The LiteLLM image has no `curl`/`wget` (checked inside the image), so the healthcheck runs `python -c "import urllib.request; …"` against `/health/liveliness`.
6. **Extra env var `PLACEHOLDER_API_KEY`.** The placeholder model must read a key from the environment, so `.env.example` has that variable; no real provider key is present anywhere.
7. **`s2s_access: s2s` with `s2s: deny: all`** was added on top of "no s2s listener" so outgoing federation is explicitly off, not only incoming.
8. **Postgres 5432 is published** on `127.0.0.1` for developer convenience (psql, GUI tools). The smoke test itself only uses `docker compose exec`. Happy to drop the port if you prefer a smaller surface.
9. **`rooms.galena.localhost`** is configured through `mod_muc`'s `hosts` option (the `host` option is deprecated in 26.07). The upload `put_url` is `http://galena.localhost:5280/upload`; uploads are not covered by the 5 smoke checks (out of scope for T-0002).
10. Local dev values in `infra/.env` are random strings generated for this test run and are not committed (the file is git-ignored).

### Blocked / needs a decision

- Nothing blocked. Questions for review: (a) keep or drop the published Postgres port; (b) whether `/api` should also allow unauthenticated loopback calls (default config does, but the spec says admin auth is required, so I require admin auth for all callers).


---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
