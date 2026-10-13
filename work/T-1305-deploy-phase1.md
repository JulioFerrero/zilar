---
id: T-1305
title: "Deploy phase 1: health checks turn healthy in ~1 s (start_interval), Caddy retries a restarting upstream instead of answering 502 (lb_try_duration), and the expand/contract migration rule is written down"
status: merged
milestone: M5
branch: task/T-1305-deploy-phase1
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1305: Deploy phase 1 (no production change)

## Spec (written by Claude, do not edit)

### Why
`docs/deploy/zero-downtime-plan.md`, Phase 1, and `docs/audit/ops-reliability-audit.md` OPS-3 steps 1–2 and OPS-5 step 4.
- **Slow health checks:** the four checks in `deploy/coolify/docker-compose.app.yml` use `interval` 5–15 s with no `start_interval`:
  - postgres `:57-62`;
  - ejabberd `:106-111`;
  - server `:228-235`;
  - web `:260-265`.
  So a new container counts as healthy only after 10–15 s.
- **No retries in Caddy:** `apps/web/Caddyfile` proxies `/api/*` (`:44-46`), `/health` (`:48-50`), `/xmpp-ws/ws` (`:52-55`) and `/upload/*` (`:65-73`) with a bare `reverse_proxy`, so a restarting upstream answers 502 at once.
- **No migration rule:** zero-downtime deploys run the old and new server side by side, so a migration must never drop or rename something the running version still uses.

### What to build
1. **Health checks:** add `start_interval: 1s` to every `healthcheck` in `deploy/coolify/docker-compose.app.yml` (Docker Engine ≥ 25; the live host runs Docker 29.1.5 per the Coolify deploy log), and to the healthchecks in `deploy/docker-compose.yml` if it has any (cite them).
2. **Caddy retries:** in `apps/web/Caddyfile`, give each of those `reverse_proxy` blocks `lb_try_duration 30s` and `lb_try_interval 250ms`. Keep every existing header, `strip_prefix` and the SEC-2 `respond 404`.
3. **Migration rule:** add a short "Migrations: expand/contract" section to `AGENTS.md`:
   - never drop or rename a column, table or constraint that the previous release still reads or writes, in the same release that stops using it;
   - add first and remove in a later release;
   - every new `.sql` file starts with `SET lock_timeout = '5s';`.
   Cite where migrations live (`apps/server/drizzle/`, or wherever `migrateSql` reads them).
4. **No tests** (config). Run `docker compose -f deploy/coolify/docker-compose.app.yml --project-directory . config -q` to validate the compose file, and `caddy validate` if Caddy is available locally (otherwise say so).

### Read first
`AGENTS.md`, `docs/deploy/zero-downtime-plan.md`, `deploy/coolify/docker-compose.app.yml`, `apps/web/Caddyfile`.

### Allowed files
`deploy/coolify/docker-compose.app.yml`, `deploy/docker-compose.yml`, `apps/web/Caddyfile`, `AGENTS.md`, `work/T-1305-deploy-phase1.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and the compose `config -q` passes.

---

## Report (written by the worker when done)

### What I did

1. **Health checks — `deploy/coolify/docker-compose.app.yml`:** added `start_interval: 1s`
   to all four `healthcheck`s (postgres, ejabberd, server, web), directly after `interval:`.
2. **Health checks — `deploy/docker-compose.yml`:** that file has five `healthcheck`s
   (postgres, ejabberd, server, web, caddy); the spec says to add it there "if it has any",
   so I added `start_interval: 1s` to all five.
3. **Caddy retries — `apps/web/Caddyfile`:** added `lb_try_duration 30s` and
   `lb_try_interval 250ms` to each of the four `reverse_proxy` blocks: `/api/*`, `/health`,
   `/xmpp-ws/ws` and `/upload/*`. Nothing else moved: the `uri strip_prefix /xmpp-ws`, the
   `/upload/*` security headers, the security headers block and the SEC-2 `respond 404`
   for other `/xmpp-ws/*` paths are unchanged.
4. **Migration rule — `AGENTS.md`:** added a "Migrations: expand/contract" section after
   "Coding rules" with the three rules from the spec (no drop/rename in the release that
   stops using it; add first, remove later; new `.sql` files start with
   `SET lock_timeout = '5s';`). It cites `apps/server/drizzle/` as the migrations folder,
   read by `migrateSql` (`apps/server/src/effect/sql.ts`, `migrationsFolder`, called from
   `apps/server/src/db/migrate.ts`).

### Files changed

- `deploy/coolify/docker-compose.app.yml` — 4× `start_interval: 1s`
- `deploy/docker-compose.yml` — 5× `start_interval: 1s`
- `apps/web/Caddyfile` — retry options on 4 `reverse_proxy` blocks
- `AGENTS.md` — new "Migrations: expand/contract" section
- `work/T-1305-deploy-phase1.md` — status + this report

### Commands and real results

- `pnpm install`: ok in 18.5s (only the pre-existing `@types/react` peer-dep warning in `apps/mobile`).
- `docker compose -f deploy/coolify/docker-compose.app.yml --project-directory . config -q`: **exit 0**. The only output is `level=warning` for the `SERVICE_*` variables not set locally (`SERVICE_PASSWORD_*`, `SERVICE_FQDN_WEB`, `SERVICE_URL_WEB`), which is expected outside Coolify. The compose file is valid.
- `caddy validate`: **not run — `caddy` is not installed locally** (`command -v caddy` finds nothing). The Caddyfile change is four `lb_*` options inside `reverse_proxy` blocks, all standard Caddy directives.
- `pnpm gate` (from repo root): summary lines —
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.4s)`
  - `PASS  format  (0.7s)`
  - `PASS  lint  (0.9s)`
  - `PASS  typecheck  (4.5s)`
  - `SKIP effect (no source files changed)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`

No unit tests were run: the change is config/docs only and the spec says "No tests (config)".

### Deviations, problems, open questions

- **`AGENTS.md` write:** the safety rules in `AGENTS.md` say "Never change `AGENTS.md`", but the task Spec (item 3) explicitly requires adding the migrations section to it and lists `AGENTS.md` under Allowed files. I followed the task Spec, which is the more specific instruction. Flagging it here so the lead can see the exception was deliberate.
- **`/health` also got retries**, as the Spec lists it (`:48-50`) even though the design plan named only `/api`, `/xmpp-ws` and `/upload`. I followed the Spec.
- `start_interval` requires Docker Engine ≥ 25; the task states the live host runs Docker 29.1.5, so this is fine.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit).**
- **The diff:**
  - `start_interval: 1s` on the four health checks in `docker-compose.app.yml` (and in `deploy/docker-compose.yml`);
  - `lb_try_duration 30s` and `lb_try_interval 250ms` on the `/api`, `/health`, `/xmpp-ws/ws` and `/upload` proxies, with SEC-2's `respond 404` and the upload headers kept;
  - an expand/contract section in `AGENTS.md`.
- **Lead note:** this alone doesn't stop the full-stack restart (Coolify Compose recreates every container); phase 2 of `docs/deploy/zero-downtime-plan.md` does.
