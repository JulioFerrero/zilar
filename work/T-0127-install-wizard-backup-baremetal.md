---
id: T-0127
title: Install wizard, backup/restore and the bare-metal install guide
status: review
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
- Wrote `deploy/galena` (725-line POSIX shell script, executable): `init` (flags + interactive prompts, all secrets from `openssl rand`, 0600 env file, refuses overwrite without `--force`, never prints secrets, `--dry-run`), `up/down/logs/status/update` thin wrappers over `docker compose` with the fixed compose+env file, `doctor` (Docker/Compose/openssl versions, free ports via ss→netstat→lsof, DNS via getent→dig→nslookup→host, server `/health` via the in-container healthcheck, fix hint per failure, exit 1 on any FAIL), `create-admin` (mints the invite code through the running server's invite CLI — there is no admin endpoint; sign-up requires the `x-galena-invite` header, `createdBy: null` links no contacts), `backup [dir]` (timestamped 0600 tgz: both `pg_dump -Fc` dumps through the running postgres, uploads volume tarball, `.env` copy, SECRETS_WARNING, manifest.json), `restore <archive>` (manifest check, stops app services, `pg_restore --clean`, uploads, `.env` with `.bak-<stamp>` of the current one, `up -d --wait`; refuses without `--yes`).
- Wrote `deploy/baremetal/`: `galena-server.service` (dedicated user, `EnvironmentFile`, `Restart=on-failure`, `NoNewPrivileges`/`ProtectSystem=strict`/`ProtectHome`/`PrivateTmp` + kernel/module/CGroup guards, `ReadWritePaths` on the server tree + `/var/lib/galena`, `UMask=0077`), `Caddyfile` (same 5 routes/path rules as the Docker Caddyfile, static `/srv/galena-web` with hashed-asset caching + CSP headers from `apps/web/Caddyfile`), `nginx-galena.conf` (alternative with the same routes, certbot-managed certs), `ejabberd.yml` (prod Docker config adapted: literal `chat.example.com` values, SQL host `localhost`, loopback ACL back, `certfiles` at `/etc/ejabberd/server.pem`, JWK recipe documented), `setup-postgres.sql` (roles/databases + `vector` + guarded read-only archive role, passwords as `psql -v` vars), `.env.example` (every variable the unit needs).
- Wrote `docs/INSTALL_BARE_METAL.md` (users, database, ejabberd, server, web build, proxy, first account, updating, backups, §8 honest about what was NOT tested) and `docs/INSTALL.md` (choose-your-install table + requirements).
- Small edits: `docs/INSTALL_DOCKER.md` (helper path + backup/restore/cron section), `README.md` (Quick start links `docs/INSTALL.md`), `deploy/.env.example` (documents the `NODE_ENV` the wizard writes and the compose file already reads).

### Files changed
- New: `deploy/galena`, `deploy/baremetal/{galena-server.service,Caddyfile,nginx-galena.conf,ejabberd.yml,setup-postgres.sql,.env.example}`, `docs/INSTALL.md`, `docs/INSTALL_BARE_METAL.md`.
- Edited: `docs/INSTALL_DOCKER.md` (+53/−4: helper path, backup/restore/cron), `README.md` (+2: Quick-start link), `deploy/.env.example` (+NODE_ENV block), `work/T-0127-install-wizard-backup-baremetal.md` (status + this Report).

### Commands run and real results
- `pnpm install`: Done in 10.9s.
- `sh -n deploy/galena`: pass. `shellcheck`: NOT installed on this machine (reported per spec; script follows POSIX, one intentional `eval` for arg reassembly, `set -eu`, quoted expansions).
- `./deploy/galena init --dry-run --domain localhost ...`: prints the plan, no secrets, exit 0. `./deploy/galena init` (scratch env file): wrote 0600 file, 0 CHANGE_ME, 5×48-hex passwords unique, JWT 64 / auth 44 / key-encryption 64 chars unique, 31 vars, no dupes.
- `./deploy/galena restore <existing-file>` without `--yes`: `error: restore overwrites live data — re-run with --yes to confirm`, exit 1 (proved).
- `caddy validate` (via `docker run caddy:2.10.2-alpine`): production `deploy/caddy/Caddyfile` → `Valid configuration`; bare-metal Caddyfile (with `{$GALENA_DOMAIN}`/`{$ACME_EMAIL}` placeholders + env) → `Valid configuration`.
- `pnpm format:check`: pass. `pnpm lint`: pass, no findings. `pnpm typecheck`: 10 tasks successful.
- Vitest: not run (no application code touched), per the T-0126 precedent cited in the spec's Checks.
- Scratch `up` attempts (project `galena-installtest`, ports 18080/18443, throwaway secrets in /tmp only, never read `infra/.env`): postgres+ejabberd reached healthy from clean volumes, but the server never did — see Problems. After the lead's stop-probing instruction: `down -v`, all 4 scratch images removed, secrets file overwritten+deleted, `docker ps`/`volume ls` filters for `galena-installtest` empty. Dev containers (`galena-dev-*`) untouched throughout.

### Problems, deviations from the spec, open questions
- **NOT done (needs a follow-up): the live `up` → healthy → backup → restore round trip was NOT proved.** Two independent blockers, both found by reading code + container logs:
  1. `deploy/docker-compose.yml` passes `SMTP_HOST: ${SMTP_HOST:-}` (etc.) which Compose renders as `SMTP_HOST=` (empty string, not unset). The server's zod schema (`.optional()` = undefined only) rejects empty strings: `Invalid server configuration: SMTP_HOST (invalid), SMTP_USER (invalid), SMTP_PASSWORD (invalid), MAIL_REPLY_TO (invalid)` — the server restart-looped on this. My wizard now *omits* those lines for a console trial, but the committed compose file still emits `KEY=` for any variable absent from the env file, so even the wizard's env cannot boot. Fix (one line each, in `deploy/docker-compose.yml`, NOT my allowed files — hence not done): either `${SMTP_HOST:-@empty@}`-style sentinels like the existing `LITELLM_*` workaround, or make the app treat `""` as unset (app change, bigger blast radius). Same latent issue for `MAIL_REPLY_TO`, and for non-SMTP installs generally.
  2. The prebuilt `galena-server:installtest` image in this workstation predates T-0128 (its mailer throws in production unconditionally); I rebuilt it from current sources mid-session, which moved the failure from the mailer-throw to problem (1). Any re-proof must rebuild or repull the server image first.
  3. Ejabberd `password authentication failed for user "ejabberd"` after `down` (without `-v`) + `init` regenerated passwords: expected Postgres semantics (init scripts run once per volume), not a bug — but the wizard's `up` gives no hint when the env no longer matches the volume. Worth a `doctor` check (compare a hash?) or a documented `down -v` warning; leaving as an open question.
- `backup`/`restore` code paths were written carefully and dry-runs/guard-clauses verified, but never executed against a running stack for the reasons above. The cron example and off-machine copy are documented but untested.
- Bare-metal guide §8 lists everything unverified: systemd unit never saw `systemd-analyze verify` (no systemd on macOS) nor a real boot; `setup-postgres.sql` never executed (its `\if`/`\gset` guards mirror proven `20-search-reader.sql` but that is not proof); nginx config syntax-only, no `nginx -t` here; invite-CLI-via-env-file invocation unconfirmed on a real machine.
- `deploy/.env.example` now documents `NODE_ENV` (needed: compose reads it, wizard writes it). No other `.env.example` changes were needed — every other wizard variable already existed there.
- No secrets printed, logged or committed at any point: `git status` shows only the files above; scratch secrets lived in /tmp and were overwritten+deleted.

### What was NOT done (per lead instruction 2026-09-30)
- Stopped all container probing on lead order; did not re-run `up`, did not test `create-admin`/`backup`/`restore` live, did not run the capped-filter Vitest command (no app code touched — nothing to run it against).

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
