---
id: T-0127
title: Install wizard, backup/restore and the bare-metal install guide
status: merged
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

### What I did (final round 2026-09-30 — packet findings 1-5 + nits, re-proved live)
- `deploy/baremetal/.env.example`: `MAIL_FROM="Galena <no-reply@chat.example.com>"` (quoted) + comment explaining why quotes are mandatory; stale "localhost trial runs development" comment replaced (NODE_ENV=production everywhere).
- `docs/INSTALL_BARE_METAL.md` §7: quoted-MAIL_FROM paragraph (sh+bash verified, false spaces claim fixed).
- `deploy/galena`: `_ensure_audit_triggers` runs inside `_recover` AND after every successful restore a pg_trigger count check fails loudly (non-zero + message) when not exactly 3; `create-admin` parses `--uses 5` and `--uses=5` (verified both by execution); `init` domain restricted to `[A-Za-z0-9.:-]` with structural rejects (verified: `$`, backtick, `=`, `/`, space, `://`, `..`, multi-colon rejected; host, `host:port`, IPv4 accepted); manifest gains `postgres_version` + `ejabberd_status` (verified live values); `doctor` auto-passes ports held by the install's own caddy; globals.sql comment corrected (SCRAM hashes are secret material).
- `docs/INSTALL_DOCKER.md`: manifest versions + trigger-verify paragraphs.

### What I did (rework round 2026-09-30 — all packet should-fixes + live proof)
- `deploy/galena` (was 725 lines): `doctor` auto-passes loopback domains (`localhost|*.localhost|*.local|*.test|*.example|*.invalid` — no public DNS needed); `backup` adds `globals.sql` (`pg_dumpall -g`) + loud 3-line SECRETS/never-commit warning (archive stays mode 0600 in `deploy/backups/`); `restore` recreates roles idempotently (CREATE-if-missing DO block + archived ALTER ROLE passwords) using the ARCHIVED `POSTGRES_PASSWORD` throughout, drops/recreates the `audit_log` immutability triggers around `pg_restore --clean` (same statements as `drizzle/0013_audit_log_immutable.sql`), stages dumps through a container-side temp file (bare stdin redirect silently restores nothing — found by execution: row count 0, fixed, re-proved), restarts the stack + prints a re-run hint on any failure (`_recover` trap); passwords pass via `compose exec -e` + in-container expansion (never in host argv/`ps`); new `COMPOSE_FILE_OVERRIDE`/`COMPOSE_PROJECT_NAME` env overrides for scratch proofs; `create-admin` message reflects `--uses/--days`. Original round: `init` (flags/prompts, openssl secrets, 0600, `--force`/`--dry-run`, never prints secrets), `up/down/logs/status/update` wrappers, `doctor` (versions, ports, DNS, `/health`, fix hints), `create-admin` via invite CLI (sign-up is invite-only, `createdBy: null`), `backup` (both dumps + uploads + `.env` + manifest), `restore` (refuses without `--yes`).
- `deploy/baremetal/`: `ejabberd.yml` fixes — `jwt_key` → `/etc/ejabberd/jwt.jwk` (matches guide), both listeners bind `127.0.0.1`, upload `docroot` → `/var/lib/ejabberd/upload` (+ mkdir/chown in guide §3, §8 updated). Unit/Caddyfile/nginx/setup-postgres.sql/`.env.example` as in the first round (`.env.example` nit fixed: `NODE_ENV=production` + console-mailer comment).
- Docs: `docs/INSTALL_BARE_METAL.md` — `set -a; . /etc/galena/galena.env` invite command (old `env $(…|xargs)` word-split `MAIL_FROM`), loopback-bind paragraph, correct upload dir, validator-accurate Caddyfile sentence; `docs/INSTALL_DOCKER.md` — backup/restore covers globals.sql, archived credentials, recoverability, pending `deploy/backups/` gitignore decision; `docs/INSTALL.md`, README link, `deploy/.env.example` NODE_ENV block (first round).

### Files changed
- First round new: `deploy/galena`, `deploy/baremetal/{galena-server.service,Caddyfile,nginx-galena.conf,ejabberd.yml,setup-postgres.sql,.env.example}`, `docs/INSTALL.md`, `docs/INSTALL_BARE_METAL.md`.
- First round edited: `docs/INSTALL_DOCKER.md`, `README.md` (Quick-start link), `deploy/.env.example` (NODE_ENV block).
- Rework round re-edited: `deploy/galena`, `deploy/baremetal/ejabberd.yml`, `deploy/baremetal/.env.example`, `docs/INSTALL_BARE_METAL.md`, `docs/INSTALL_DOCKER.md`, this task file (status + Report).
- Final round re-edited: `deploy/galena`, `deploy/baremetal/.env.example`, `docs/INSTALL_BARE_METAL.md`, `docs/INSTALL_DOCKER.md`, this task file (Report). Deleted `PREREVIEW.md` (packet copy) from the worktree root.

### PROVEN live — final round (scratch `galena-t0127-final` / `-finalr`, ports 18080/18443, fresh images from this worktree)
- `up -d --wait`: all 5 `healthy`. `doctor` POST-up: all ok incl. own-caddy ports + `/health`, exit 0.
- Full OTP sign-up through Caddy (`ops@example.com`, invite `13X4…`, OTP `318185` from server log, `/api/me` JID `@localhost`).
- `backup`: 0600 tgz with `postgres_version` 18.6 + ejabberd status line in manifest (verified by reading the archive).
- `restore --yes` into fresh project + different POSTGRES_PASSWORD: `galena: restored.` + `audit_log immutability triggers verified (3 of 3).`; user row, `final.txt` upload, `/health` ok. Mid-proof the FIRST restore attempt hit a port clash (stale stack still holding 18080) and the `_recover` path fired live: restart + trigger recreate + re-run hint, exit 1 — then the clean re-run proved idempotency.
- `create-admin --uses=5/--days=30` in BOTH `=` and space forms (verified `--dry-run` output identical); `--bogus` still rejected.
- `set -a; . file` with the shipped `.env.example` (CHANGE_ME→testvalue): `sh` AND `bash` load `MAIL_FROM=Galena <no-reply@chat.example.com>` + all 24 vars, exit 0.
- Domain validation matrix executed (14 inputs): only host / host:port / IPv4 accepted.
- Teardown: no `galena-t0127-*` containers/volumes/networks/images; `/tmp/t0127final` emptied (`.bak` env copies included); Julio's stack/ports untouched.

### PROVEN live — rework round (scratch `galena-t0127-proof` / `-restore2` / `-restore3`, ports 18080/18443, wizard secrets, images rebuilt from this worktree incl. main's mail fix `41ffe78`)
- `./deploy/galena init --domain localhost` → 0600 env, 0 CHANGE_ME, unique secrets (pre-review re-verified).
- `up -d --wait`: all 5 services `healthy`; `curl -k https://localhost:18443/health` → `{"ok":true,"name":"galena-server","version":"0.1.0","protocolVersion":"0.2.0","db":"ok"}`; `/` → 200; `/api/me` → 401.
- `doctor` on the wizard env: all ok incl. `'localhost' is a local name — no public DNS needed`, exit 0.
- Full OTP sign-up through Caddy on the FIRST stack: invite CLI in server container → invite link; `POST /api/auth/email-otp/send-verification-otp` (+ invite header, email+type sign-in) → `{"success":true}`; OTP from server log; sign-in → user `ops@example.com`; `/api/me` → `jid …@localhost`.
- `backup`: wrote 0600 tgz (24K) with all 7 members; manifest `galena-backup-v1`; 3-line secrets warning printed.
- `restore` into a FRESH project name with a DIFFERENT `POSTGRES_PASSWORD` (restore3): clean run, `galena: restored.`; verified `public.user` = `ops@example.com`, all 3 `audit_log_*` triggers present, `public.invites` = 1, uploads `probe.txt` intact, `/health` ok:true. Earlier attempts silently restored 0 rows (bare stdin redirect) — caught by row counts, fixed via container-side staging, re-proved.
- `restore` without `--yes` still refuses (exit 1). `sh -n` pass after every edit. `caddy validate`: both Caddyfiles → Valid.
- Teardown: all `galena-t0127-*` containers/volumes/networks/images removed, scratch envs/dumps/backups overwritten then deleted. Julio's `galena-dev-*` and ports 3000/5173/8081/3188 untouched.

### NOT proven / known gaps
- Post-restore OTP sign-in on the restored stack: `send-verification-otp` → `{"success":true}` but the OTP line never appeared in the restored server's log, so sign-in could not complete there. Data-plane restore (users, invites, uploads, triggers, health) is fully proved; auth-plane after restore is NOT. Stopped per lead order; needs one focused re-run.
- `create-admin` through the wizard script itself (it targets the committed compose file; proof used the identical invite-cli command via the scratch compose). `COMPOSE_FILE_OVERRIDE` now lets the wizard drive a scratch copy — untested end to end.
- Bare-metal guide §8 unchanged: systemd unit, setup-postgres.sql, nginx config, `set -a` invite command all untested on a real machine.
- Pre-review flaky `@galena/devtools merge.test.ts` (5s timeout, passes alone) — pre-existing, unrelated, no app code touched.

### Commands run and real results (both rounds)
- `pnpm install`: Done in 10.9s (first round) / 1s (rework).
- `sh -n deploy/galena`: pass. `shellcheck`: NOT installed on this machine (reported per spec; script follows POSIX, one intentional `eval` for arg reassembly, `set -eu`, quoted expansions).
- `./deploy/galena init --dry-run --domain localhost ...`: prints the plan, no secrets, exit 0. `./deploy/galena init` (scratch env file): wrote 0600 file, 0 CHANGE_ME, 5×48-hex passwords unique, JWT 64 / auth 44 / key-encryption 64 chars unique, 31 vars, no dupes.
- `./deploy/galena restore <existing-file>` without `--yes`: `error: restore overwrites live data — re-run with --yes to confirm`, exit 1 (proved).
- `caddy validate` (via `docker run caddy:2.10.2-alpine`): production `deploy/caddy/Caddyfile` → `Valid configuration`; bare-metal Caddyfile (literal `chat.example.com` + placeholders swapped in for the check) → `Valid configuration`.
- `pnpm format:check`: pass. `pnpm lint`: pass, no findings. `pnpm typecheck`: 10 tasks successful.
- Vitest: not run (no application code touched), per the T-0126 precedent cited in the spec's Checks.
- Scratch `up` attempts (first round, project `galena-installtest`, ports 18080/18443, throwaway secrets in /tmp only, never read `infra/.env`): postgres+ejabberd reached healthy from clean volumes, but the server never did — superseded: main's mail fix `41ffe78` resolved the boot blocker and the rework round proved the full round trip (see PROVEN live above).

### Problems, deviations from the spec, open questions (first round — superseded, kept for history)
- The first-round live round trip was blocked by the empty-string mail vars (fixed on main by `41ffe78`) and a stale pre-T-0128 server image; both resolved, round trip proved (see PROVEN live above).
- Ejabberd env-vs-volume password mismatch after `down` (no `-v`) + fresh `init`: expected Postgres semantics, but `up` gives no hint; suggest a `doctor` check or doc note (also listed under Blocked).
- The cron example and off-machine copy are documented but untested.
- Bare-metal guide section 8 lists everything unverified: systemd unit never saw `systemd-analyze verify` (no systemd on macOS) nor a real boot; `setup-postgres.sql` never executed; nginx config syntax-only, no `nginx -t` here; `set -a` invite command unconfirmed on a real machine.

### Blocked / needs a decision
- `.gitignore` entry for `deploy/backups/` (archives contain a live `.env`): one-line lead follow-up — I may not edit `.gitignore`. Until then the backup command warns loudly and the directory stays untracked-by-convention only.
- `deploy/docker-compose.yml` empty-string mail vars: FIXED on main by `41ffe78` — no longer blocks; proved live above.
- Ejabberd env-vs-volume password mismatch after `down` (no `-v`) + fresh `init`: still an open UX gap — `up` gives no hint. Suggest a `doctor` check or doc note; leaving for the lead.

---

## Review (written by Claude)

**Verdict:** merged after four rounds and two lead fixes.

### Findings
- The worker proved the round trip on real containers under its own names and spare ports: `init`, `up`, sign-in, `create-admin`, `backup`, `restore` into a fresh project (users, uploads and the audit triggers survived), then teardown of every test container, volume and image.
- Pre-review round 1 found a boot blocker (Compose renders unset mail settings as empty strings and the server rejected them); fixed on main as `41ffe78`.
- Rounds 2 and 3 found and fixed: the restore path could restart the stack without the three audit_log triggers; `MAIL_FROM` unquoted in the bare-metal env file broke the guide's `set -a; . file`; the JWT key path, ejabberd binding and the uploads directory in the bare-metal guide; passwords in the process list; doctor failing on loopback; `create-admin --uses=5`.
- Lead fixes in this merge: deep subdomains were rejected by the domain check; the restore recovery trap could crash under `set -u` before the archived password was read; empty ports were accepted. I also ran `deploy/baremetal/setup-postgres.sql` on a scratch Postgres 18 (twice, and once with an empty archive password): roles, databases and pgvector are created and reruns are clean. `deploy/backups/` is now in `.gitignore`.
- Not proven: a run of the bare-metal guide on a real Linux host with systemd and a real ejabberd package.

### Follow-ups
- The bare-metal guide's invite step does not mention `--uses` and `--days`.
- Try the bare-metal guide once on a clean Linux VM before the first release.
