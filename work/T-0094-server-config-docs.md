---
id: T-0094
title: Server configuration reference (docs only) — every environment variable, its default and what it turns on
status: todo
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
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**
