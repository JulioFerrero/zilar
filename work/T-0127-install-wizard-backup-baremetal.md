---
id: T-0127
title: Install wizard, backup/restore and the bare-metal install guide
status: planned
milestone: M6
branch: task/T-0127-install-wizard-backup-baremetal
model: meta/muse-spark-1.3-contributor
depends_on: [T-0126]
estimate: 2 days
---

# T-0127: Install wizard, backup/restore, bare metal

## Spec (written by Claude, do not edit)

### Why
D30: installing Galena must be easy, including for people who do not want Docker and people who will just run a command. T-0126 gives the images and the compose file; this task removes the manual steps (secrets, config) and covers the two other paths: backups and a bare-metal install.

### 1. `galena` install helper (`deploy/galena` a single POSIX shell script, no dependencies beyond `sh`, `openssl`, `docker`)
- `./galena init`: asks (or takes flags for non-interactive use) for the domain, an ACME email and an admin email; **generates every secret with `openssl rand`** (Postgres passwords, ejabberd admin, JWT/HMAC secrets, Better Auth secret), writes `deploy/.env` with mode 0600 (refuses to overwrite an existing file unless `--force`), prints the next command and the DNS records the user needs. Never prints a secret to the terminal (it says where the file is).
- `./galena up|down|logs|status|update` thin wrappers over `docker compose` (`update` = pull, up, health wait) with clear messages.
- `./galena doctor`: checks Docker and Compose versions, that ports 80/443 are free, that the domain resolves to this machine (best effort), and that the server `/health` answers; prints a fix hint for each failure.
- `./galena create-admin`: creates the first account through the running server (whatever the supported way is; read the auth routes; if there is none, the first registered user simply becomes the owner of the server; document which).
- Tested with `shellcheck` if it is installed (report if not) and a dry-run mode (`--dry-run` prints what would be written without writing).

### 2. Backup and restore
- `./galena backup [dir]`: a timestamped archive with a `pg_dump` (custom format) of **both** databases (Galena and ejabberd) taken through `docker compose exec`, the ejabberd uploads volume, the `.env` (clearly marked as containing secrets, mode 0600), and a manifest with versions. `./galena restore <archive>`: stops the app services, restores, starts, checks health; refuses to run without an explicit `--yes`.
- Documents a cron/systemd-timer example for nightly backups and how to copy them off the machine. A restore test in the scratch project: create data, back up, wipe the volumes, restore, data is back (report it).

### 3. Bare metal (`docs/INSTALL_BARE_METAL.md` plus files under `deploy/baremetal/`)
- Supported layout: Linux with **systemd**, Node LTS via the system or `fnm`/`nvm`, `pnpm`, **PostgreSQL 16+ with pgvector** (or 18), **ejabberd** installed from the distribution package or the official binary, **Caddy or nginx** for HTTPS, the built web app served as static files.
- Ship: `deploy/baremetal/galena-server.service` (systemd unit: dedicated user, `EnvironmentFile`, `Restart=on-failure`, hardening directives such as `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, read-write only on its data dir), `deploy/baremetal/Caddyfile` and an nginx alternative, `deploy/baremetal/ejabberd.yml` (the production config from T-0126, adapted for a local install), a `deploy/baremetal/setup-postgres.sql` creating the roles and databases with placeholder passwords, and `deploy/baremetal/.env.example`.
- The guide walks through it step by step (users, database, ejabberd, server, web build, proxy, first account, updating, backups) and says plainly that this path is for people comfortable with Linux. **Only what you can verify**: validate systemd units with `systemd-analyze verify` if available (probably not on macOS: say so), validate the Caddyfile with `caddy validate` or `docker run caddy caddy validate`, and mark anything unverified as "not tested on a real machine".

### 4. Docs
- `docs/INSTALL.md`: a one-page "choose your install" (Docker in five minutes, Coolify, bare metal, requirements: 1 vCPU / 2 GB RAM is enough for a small group and a few hundred users of chat; more only if many AI turns run on the same machine), linking the three detailed guides; update `README.md` "Quick start" to link it (allowed for this task).

### Rules
- Same test-isolation rules as T-0126: scratch project name `galena-installtest`, ports 18080/18443, never touch `galena-dev-*` containers or ports 3000, 3188, 5173, 5222, 5280, 5432, 8081; throwaway secrets only; never read `infra/.env`.
- No new dependencies; the helper is shell only. No application code changes (if something in the app blocks you, put it under "Blocked / needs a decision").

### Read first
- `AGENTS.md`; `work/T-0126-production-images-compose.md` and its merged files (`deploy/**`, `docs/INSTALL_DOCKER.md`); `docs/PROJECT_PLAN.md` D30; `apps/server/src/auth/**` (first-account behaviour); `docs/SERVER_CONFIG.md`

### Allowed files
- `deploy/galena`, `deploy/baremetal/**`, `deploy/.env.example` (only to add variables the wizard needs), `docs/INSTALL.md`, `docs/INSTALL_BARE_METAL.md`, `docs/INSTALL_DOCKER.md` (small edits), `README.md` (Quick start link only), `work/T-0127-install-wizard-backup-baremetal.md`

**Not allowed:** application source, dependencies, real secrets, pushing anything.

### Checks
- `sh -n deploy/galena` (syntax), `shellcheck deploy/galena` if available, `./deploy/galena init --dry-run` prints the plan, `./deploy/galena init` in the scratch dir writes a 0600 `.env` whose values are non-placeholder and unique, `./deploy/galena up` reaches healthy (scratch project), backup then restore round trip proved, `caddy validate` on the bare-metal Caddyfile.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck` still pass.

### Acceptance criteria
- [ ] From a fresh clone: `./deploy/galena init && ./deploy/galena up` gives a working instance; no secret is ever printed.
- [ ] Backup and restore round trip verified; restore refuses without `--yes`.
- [ ] The bare-metal guide is honest about what was and was not tested.

### Out of scope
- Multi-node/HA, Kubernetes, auto-update daemons, TLS for ejabberd federation (federation is off), the hosted service, usage or cost tracking.

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
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
