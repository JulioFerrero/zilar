---
id: T-0094
title: Server configuration reference (docs only) — every environment variable, its default and what it turns on
status: review
milestone: M4
branch: task/T-0094-server-config-docs
model: minimax-coding-plan/MiniMax-M3
depends_on: []
estimate: 0.5 day
---

# T-0094: Server configuration reference

## Spec (written by Claude, do not edit)

### Goal

Julio and later operators need one page that says how to run the server and what every setting does. Today the truth is spread over `apps/server/src/config.ts`, `index.ts`, `.env.example` and task files. Write `docs/SERVER_CONFIG.md`, **derived from the code**, accurate and short. Docs only; no code changes.

### Content (in this order)
1. **What runs where**: one paragraph and a small table of the processes and default ports (Galena server 3188, web dev server 5173 proxying `/api`, Postgres, ejabberd, LiteLLM, optional runner hub). Ports come from the code and `infra/` files; do not invent any.
2. **Environment variables**: one table with columns *Variable | Required? | Default | What it does | Notes*. Every variable that `config.ts` (and any other `process.env` / config-schema read in `apps/server/src`, found with `git grep -n "process.env"` and by reading `config.ts` and `index.ts`) accepts, grouped: core (database, auth, URLs, origins), XMPP/ejabberd, AI (LiteLLM, key encryption), feature flags (`AGENT_GATEWAY_ENABLED`, `RUNNER_HUB_ENABLED`, …), voice, git proxy, limits/timeouts. Say plainly which ones are **secrets** (never commit, never log) and give **placeholders only** (`CHANGE_ME`) — never a real value. **Do not open, read or quote any real `.env` file**; use `.env.example` files and the code.
3. **Feature flags and what each one enables**, including what happens when a prerequisite is missing (for example the agent gateway staying off without LiteLLM or the key master key), each backed by the line in the code that decides it (cite `file:line`).
4. **Database**: how migrations run (at startup? by command? read `db/` and `index.ts`), the generate command (`pnpm --filter @galena/server db:generate`, never `npx`), and the two append-only guarantees (audit log triggers).
5. **Background jobs the server starts** (approvals sweeper, action-recovery timer, agent gateway reconcile, runner hub) with their intervals, read from the code.
6. **Health and shutdown**: `/health`, graceful shutdown behaviour and grace period (from `index.ts`).

### Rules
- Every claim must be checkable in the code. If a variable's purpose is unclear, say "unclear from the code" and list it under *Open questions* at the end of the file rather than guessing.
- English, plain sentences, no marketing. Tables where a table is clearer.
- Do not add or rename any variable; if you find a variable that is read but missing from `.env.example`, or documented but never read, list it under *Mismatches found* at the end of `docs/SERVER_CONFIG.md` (do not fix it here).

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/config.ts`, `config.test.ts`, `index.ts`, `app.ts`, `apps/server/.env.example`, `infra/.env.example`, `infra/` compose files (ports only), `docs/LEAD_PLAYBOOK.md` §12 (local stack)

### Allowed files
- `docs/SERVER_CONFIG.md` (new)
- `work/T-0094-server-config-docs.md`

**Not allowed:** any other file, any real `.env`, any code.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
```
(Run `pnpm exec prettier --write docs/SERVER_CONFIG.md` if format:check complains about it.)

### Acceptance criteria
- [ ] Every variable in `config.ts` appears exactly once with the right default and required-ness.
- [ ] No secret values, no real hostnames or tokens; placeholders only.
- [ ] *Mismatches found* and *Open questions* sections exist (write "none" if empty).

---

## Report (written by the worker when done)

### What I did

Read `AGENTS.md`, the task file, `apps/server/src/config.ts`, `config.test.ts`, `index.ts`, `app.ts`, `xmpp/config.ts`, `apps/server/.env.example`, `infra/.env.example`, `infra/docker-compose.dev.yml`, `docs/LEAD_PLAYBOOK.md` §12, the `process.env` references in `apps/server/src` (`git grep -n "process.env" apps/server/src`), and the relevant background-job files (`approvals/sweeper.ts`, `actions/gateway.ts`, `agents/gateway.ts`, `machines/hub.ts`, `db/migrate.ts`, `apps/server/drizzle/0012_add_audit_log.sql`, `0013_audit_log_immutable.sql`, `0014_thick_runaways.sql`, `0015_late_randall_flagg.sql`). Wrote `docs/SERVER_CONFIG.md` covering: the processes/ports table, every variable in `config.ts` and `xmpp/config.ts` (core, XMPP/ejabberd, AI/LiteLLM, GitHub App, feature flags, voice/git/limits), the two feature flags with the prerequisites that turn each into a no-op (and the `file:line` citations), migrations (startup + `pnpm --filter @galena/server db:generate` / `db:migrate`, never `npx`), the two audit-log append-only triggers (`audit_log_no_update`, `audit_log_no_delete`, `audit_log_no_truncate` on `audit_log`), the background-job cadence table, and `/health` + graceful shutdown (3 s idle grace, 15 s hard exit). Closed with the required *Mismatches found* and *Open questions* sections.

Did not touch any other file. Did not open a real `.env` (only `.env.example`).

### Files changed

- `docs/SERVER_CONFIG.md` (new)
- `work/T-0094-server-config-docs.md` (front matter status, this Report)

### Commands run and real results

- `pnpm install` — succeeded: `Done in 6.4s using pnpm v10.32.1`, `+ @types/node 24.19.0`, `+ oxlint 1.85.0`, `+ prettier 3.9.9`, `+ turbo 2.11.4`, `+ typescript 6.0.3`, `+ vitest 5.0.2`. Lockfile was already up to date, so only the workspace devDependencies were reinstalled.
- `pnpm format:check` — succeeded: `Checking formatting...` then `All matched files use Prettier code style!` (exit 0). The `docs/` directory is in `.prettierignore`, so `docs/SERVER_CONFIG.md` is intentionally excluded and does not need a `prettier --write` step.
- `pnpm lint` — succeeded: `> galena@ lint … > oxlint .` then exit 0, no warnings.

### Problems, deviations from the spec, open questions

- `apps/server/.env.example` ends at `AGENT_GATEWAY_ENABLED` and does not document `LITELLM_BASE_URL`, `LITELLM_MASTER_KEY`, `GALENA_KEY_ENCRYPTION_KEY`, `RUNNER_HUB_ENABLED`, `RUNNER_HUB_PORT` or the three `GITHUB_APP_*` variables, even though all of them are accepted by the schema. Listed in *Mismatches found*. Did not fix (out of scope).
- The spec's "two append-only guarantees (audit log triggers)" is one table (`audit_log`) with three triggers on it (`UPDATE`, `DELETE`, `TRUNCATE`). Described it as the single append-only guarantee, naming all three trigger names — the spec phrasing is preserved by treating the three triggers as one guarantee applied at three levels.
- Env vars that appear only in integration test files (`GALENA_AGENT_INTEGRATION`, `GALENA_AIS_INTEGRATION`, `GALENA_AI_MODELS_INTEGRATION`, `GALENA_VOICE_INTEGRATION`, `GALENA_CONNECTIONS_INTEGRATION`, `GALENA_LITELLM_INTEGRATION`, plus the matching `*_URL` and `XMPP_WS_URL` variants) are test-suite configuration, not server configuration. Not included in the main table; called out under *Open questions* so the lead can decide whether to add them later.
- The web app reads one env var (`GALENA_API_URL` in `apps/web/vite.config.ts:16`); it is not a `@galena/` variable, but it has to agree with `PORT` on the server. Called out under *Open questions*.
- The "every other `process.env` read in `apps/server/src`" check (`git grep -n "process.env" apps/server/src`) found only test files and CLI scripts (`db/migrate-cli.ts`, `auth/invite-cli.ts`) that delegate to `loadServerConfigOrExit(process.env)`. No new variables to document.

### Blocked / needs a decision

None.

---

## Review (written by Claude)

**Verdict:**
