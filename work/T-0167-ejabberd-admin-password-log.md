---
id: T-0167
title: Keep the ejabberd admin password out of the container logs
status: merged
milestone: M5
branch: task/T-0167-ejabberd-admin-password-log
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: []
estimate: 0.5 day
---

# T-0167: Keep the ejabberd admin password out of the container logs

## Spec (written by Claude, do not edit)

### Why
On the first live install, the ejabberd container's log showed the admin password that the base image prints while it registers the admin account from `REGISTER_ADMIN_PASSWORD` (`deploy/docker-compose.yml:77`, `deploy/coolify/docker-compose.yml:71`; the mechanism is mentioned in `deploy/ejabberd/jwt-entrypoint.sh`). Logs get pasted into issues and chats and shipped to log tools, so a secret must never be in them. The base image is `ghcr.io/processone/ejabberd:26.07` and is not ours, so the fix has to live in our entrypoint and compose files.

### What to build

1. **Reproduce first, with a harmless value.** Build `deploy/ejabberd/Dockerfile` locally, start it with a recognizable fake password such as `SENTINEL_ADMIN_PW_123` (never a real one) and the other variables it needs (see `deploy/.env.example`; a throwaway Postgres container is acceptable if the config needs one), and show with `docker logs` exactly which line contains the sentinel and which script prints it. Put that line (with the sentinel) in the Report. Stop and remove every container and network you created afterwards.
2. **Fix it in our code.** Stop passing the password through the mechanism that prints it. Register the admin account ourselves from `jwt-entrypoint.sh`: wait until the server answers (`ejabberdctl status` in a bounded loop with a clear timeout and error), then run `ejabberdctl register` (or `change_password` if the account exists, so a password change in the environment still takes effect) with ALL output of that command discarded, never `set -x`, never echoing the value, and the exit status checked so a failure prints a fixed message without the password. The server process stays the container's main process (keep `exec ... tini`); the registration runs as a background step that cannot keep the container from stopping. The admin password is read from `EJABBERD_ADMIN_PASSWORD` in the container environment.
3. **Compose files.** Remove `REGISTER_ADMIN_PASSWORD` from both compose files and pass the same value under the name the entrypoint reads. For Coolify keep the existing magic variable `SERVICE_PASSWORD_EJABBERDADMIN` (no underscore in the id; do not rename it, the live install has its value) and keep the server's `EJABBERD_ADMIN_PASSWORD` as is, so the live deployment only needs the new image.
4. **A regression test that can fail.** A shell test under `deploy/tests/` that starts the built image with the sentinel password and asserts: the admin account exists (`ejabberdctl check_account`), the sentinel does NOT appear anywhere in `docker logs` (stdout and stderr), and a second start with a different sentinel changes the password and still leaks nothing. If the test needs Docker and the CI machine has none, make it skip with a clear message, the way the other deploy tests behave. Run it locally and put the real output in the Report.
5. **Docs.** One sentence in `docs/INSTALL_DOCKER.md` that logs never contain the admin password.

### Read first
`AGENTS.md` (secrets rules), `deploy/ejabberd/jwt-entrypoint.sh`, `deploy/ejabberd/Dockerfile`, `deploy/ejabberd/ejabberd.yml`, `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/.env.example`, `deploy/tests/` (existing shell test style), `apps/server/src/xmpp/` (how the server logs in as admin).

### Allowed files
`deploy/ejabberd/**`, `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.yml`, `deploy/.env.example` (comments only), `deploy/tests/**`, `docs/INSTALL_DOCKER.md`, `work/T-0167-ejabberd-admin-password-log.md`. No application code, no new dependencies.

### Checks
```bash
pnpm format:check
sh deploy/tests/<your new test>.sh
sh deploy/tests/storage-safety.test.sh
```
Also build the image once and run the new test against it; the Report shows the real results.

### Acceptance
- `docker logs` of a fresh start and of a restart never contain the admin password (test, not a claim).
- The admin account exists and can log in after a fresh start; changing the password variable and restarting changes the password.
- A failing registration prints a fixed message without the password and does not hide that ejabberd itself is running or not.
- The Coolify compose still uses `SERVICE_PASSWORD_EJABBERDADMIN`, so the live install keeps working with the same stored value.

### Out of scope
Rotating the password that was already printed on the live install (Julio will do that), other secrets in other containers (check and list them in the Report only), changing the base image.

---

## Report (written by the worker when done)

### What I did
Stopped passing the admin password through the base image's
`REGISTER_ADMIN_PASSWORD` mechanism (it echoes
`ejabberdctl register ... <password>` into the container log) and register
the admin account from our own entrypoint instead, with all command output
discarded.

- `deploy/ejabberd/jwt-entrypoint.sh`: after the push-host step, a
  background step waits for `ejabberdctl status` in a bounded loop
  (60 x 2s, fixed timeout message), then runs `ejabberdctl register` — or
  `change_password` when the account already exists, so a password change
  in the environment takes effect. All output of register/change_password
  is discarded (never `set -x`, never echoed); failures print a fixed
  message without the password. The password is read from
  `EJABBERD_ADMIN_PASSWORD`. The step ignores stop signals so it cannot
  delay `docker stop`, and the server stays the main process
  (`exec ... tini`). `REGISTER_ADMIN_PASSWORD` must stay unset.
- `deploy/docker-compose.yml`: ejabberd service now sets
  `EJABBERD_ADMIN_PASSWORD: ${EJABBERD_ADMIN_PASSWORD:?...}` instead of
  `REGISTER_ADMIN_PASSWORD`. Server side unchanged.
- `deploy/coolify/docker-compose.yml`: ejabberd service now sets
  `EJABBERD_ADMIN_PASSWORD: ${SERVICE_PASSWORD_EJABBERDADMIN}` (same magic
  variable, no underscore in the id — the live install keeps its stored
  value). Server's `EJABBERD_ADMIN_PASSWORD` line unchanged.
- `deploy/.env.example`: comment-only update — notes the entrypoint
  registers the account without printing it and that logs never contain it.
- `deploy/tests/admin-password-log.test.sh` (new): builds the image from
  deploy/, starts it with sentinel passwords against a throwaway Postgres,
  asserts account exists + live password, sentinel nowhere in
  `docker logs`, restart with a new sentinel changes the password and
  leaks nothing, and all three compose files (plain, Coolify, dev) wire
  the password under the entrypoint's name only. Also asserts both
  entrypoint copies (deploy + infra) carry the same registration block
  and the unset-variable warning. Skips with a clear message when Docker
  is missing. Removes all containers/networks afterwards.
- `docs/INSTALL_DOCKER.md`: one sentence (in the ejabberd-unhealthy
  troubleshooting entry) that container logs never contain the admin
  password, plus a carve-out that `EJABBERD_ADMIN_PASSWORD` — unlike the
  other `*_PASSWORD` values — takes effect on restart via
  `change_password`, no volume reset needed.

### Reproduction (before the fix, throwaway sentinel only)
Built `deploy/ejabberd/Dockerfile` and started it with
`REGISTER_ADMIN_PASSWORD=SENTINEL_ADMIN_PW_123` (plus a throwaway Postgres
and the other env vars). `docker logs` contained exactly one sentinel line:
`49::> ejabberdctl register admin repro.example SENTINEL_ADMIN_PW_123`.
It comes from the base image: `/usr/local/bin/ejabberdctl` builds
`CTL_ON_CREATE="register ... $REGISTER_ADMIN_PASSWORD ..."` and
`/opt/ejabberd-26.07/bin/ejabberdctl` `post_waiter_loop` echoes
`:> ejabberdctl $HEAD2` before running it. Containers and network removed
afterwards.

### Commands and real results (review round)
- `pnpm install`: done (848ms).
- `sh deploy/tests/admin-password-log.test.sh`: `pass=24 fail=0` —
  image builds; fresh start: account exists, sentinel live, sentinel
  nowhere in logs; restart: new password live, old rejected, no leak;
  all three compose files no longer set REGISTER_ADMIN_PASSWORD; both
  entrypoints carry the registration block and the unset warning; plain
  compose passes EJABBERD_ADMIN_PASSWORD, Coolify keeps
  SERVICE_PASSWORD_EJABBERDADMIN mapped to EJABBERD_ADMIN_PASSWORD.
  Full run takes ~4 min (two boots). Running dev containers
  (zilar-dev-*) were not touched; only t0167-prefixed containers/networks
  were created and all were removed, test image deleted afterwards.
- `sh deploy/tests/storage-safety.test.sh`: `pass=24 fail=0`.
- `pnpm format:check`: fails only on `PREREVIEW.md` (the lead's untracked
  review file, not mine to edit); every file I changed passes
  (`prettier --check` on the compose files, yml, task file: "All matched
  files use Prettier code style!").
- `sh -n` on both entrypoints and the test: syntax OK.

### Commands and real results (first round)
- `pnpm install`: done (7.4s).
- `pnpm format:check`: "All matched files use Prettier code style!"
  (before the change and after).
- `sh deploy/tests/admin-password-log.test.sh`: `pass=12 fail=0` —
  image builds; fresh start: account exists, sentinel password live,
  sentinel nowhere in logs, no REGISTER_ADMIN_PASSWORD mention; restart:
  new password live, old password rejected, no leak; both compose files
  no longer set REGISTER_ADMIN_PASSWORD, plain compose passes
  EJABBERD_ADMIN_PASSWORD, Coolify keeps SERVICE_PASSWORD_EJABBERDADMIN
  mapped to EJABBERD_ADMIN_PASSWORD. Full run takes ~4 min (two boots).
  Note: the first run (before a test bugfix) was `pass=10 fail=2` — the
  two failures were the test's own `grep REGISTER_ADMIN_PASSWORD`
  matching the new comments in the compose files, not a real leak; fixed
  by matching `REGISTER_ADMIN_PASSWORD:` (the env-key shape).
- `sh deploy/tests/storage-safety.test.sh`: `pass=24 fail=0` (both compose
  files still render after the env rename).
- Test image `zilar-ejabberd-adminpw-test:local` removed after the run.
  `docker ps -a` / `docker network ls` show no leftover t0167 containers
  or networks.

### Security checklist
- The admin password never reaches logs: register/change_password output
  fully discarded, failure messages are fixed strings, no `set -x`, value
  never echoed. Verified by the test scan of `docker logs`, not a claim.
- No deletes/updates in app code; no caps/uniqueness rules touched; no new
  routes; no audit entries. No secrets read, printed or committed (only
  throwaway sentinels used in local containers, removed afterwards).

### Other secrets in other containers (spec asks to list only)
- `server`: `DATABASE_URL`, `XMPP_ARCHIVE_DATABASE_URL` (embed DB
  passwords), `BETTER_AUTH_SECRET`, `ZILAR_KEY_ENCRYPTION_KEY`,
  `LITELLM_MASTER_KEY`, `SMTP_PASSWORD`, `PUSH_VAPID_PRIVATE_KEY`,
  `PUSH_STORAGE_KEY`, `EJABBERD_ADMIN_PASSWORD` (sent as Basic-auth header
  to ejabberd /api — not logged: `apps/server/src/logger.ts:17` redacts
  `req.headers.authorization`; the admin client itself logs nothing), JWT
  secret. These arrive as env vars, not command lines, so they do not hit
  `docker logs` the way REGISTER_ADMIN_PASSWORD did — but `DATABASE_URL`
  with an embedded password could leak if the server ever logs its config
  (worth a check in a follow-up).
- `postgres`: `POSTGRES_PASSWORD`, `ZILAR_DB_PASSWORD`,
  `EJABBERD_DB_PASSWORD`, `ZILAR_ARCHIVE_DB_PASSWORD` (env only).
- `ejabberd`: `EJABBERD_MACRO_SQL_PASSWORD`, `EJABBERD_MACRO_PUSH_COMPONENT_SECRET`
  (macros consumed by the server at boot; not echoed), `ZILAR_XMPP_JWT_SECRET`
  (only its base64url JWK form is written to a 0600 file inside the
  container).
- `zilar doctor`/`backup --dry-run` outputs contain no secret material
  (covered by the storage-safety test).

### Deviations / open questions
- Lead-approved scope extension (review round): `infra/ejabberd/jwt-entrypoint.sh`
  and `infra/docker-compose.dev.yml` mirror the fix (same registration
  block, `REGISTER_ADMIN_PASSWORD` replaced with `EJABBERD_ADMIN_PASSWORD`
  for the dev stack). Dev compose still bind-mounts the entrypoint, so no
  dev image rebuild is needed; running dev containers were not restarted
  or touched.
- Changed after review: the entrypoint now prints one fixed warning (no
  values) when `EJABBERD_ADMIN_PASSWORD`/`EJABBERD_MACRO_ADMIN` is unset
  instead of skipping silently; the dead `grep 'REGISTER_ADMIN_PASSWORD:'`
  log check is removed from the test (the sentinel scan is the real
  guard); the doc paragraph now carves out `EJABBERD_ADMIN_PASSWORD` from
  the volume-reset rule.
- The failing-registration path (fixed message, ejabberd still running)
  is implemented but was not exercised live — forcing it would need a
  broken SQL backend while the server answers, which the throwaway setup
  does not cover. The message shape is asserted by reading the script,
  not by a test run.

## Review (written by Claude)

Approved and merged after two pre-review rounds. I ran the new leak test myself on the final tree (24 checks, passing five times, and twice at the same time), plus `storage-safety.test.sh` (24 passing), format and lint.

- What changed: the ejabberd entrypoint registers the admin account itself with all output discarded (register, then change_password so a changed `EJABBERD_ADMIN_PASSWORD` takes effect on restart), `REGISTER_ADMIN_PASSWORD` is gone from the plain and Coolify compose files (the Coolify file keeps `SERVICE_PASSWORD_EJABBERDADMIN`), and a Docker-based test proves the sentinel password is nowhere in `docker logs` on a fresh start or after a restart.
- Round 1 (worker): dev stack mirrored (`infra/ejabberd/jwt-entrypoint.sh`, `infra/docker-compose.dev.yml`, approved by me), docs carve-out for `EJABBERD_ADMIN_PASSWORD`, a dead check removed, a fixed warning when the admin password is unset.
- Round 2 (lead): the first run of the test failed once while another run was using Docker, because container, network and image names and a temp file were fixed. Names now carry a per-run suffix, the temp file is `mktemp`, and cleanup also removes the image; two simultaneous runs both pass. `docs/SERVER_CONFIG.md` no longer describes the old mechanism or stale line numbers.
- Scope sign-off (lead): `infra/docker-compose.dev.yml`, `infra/ejabberd/jwt-entrypoint.sh`, `docs/SERVER_CONFIG.md`.
- Not exercised: the failure path where registration fails while the server answers (three lines, output discarded, disclosed by the worker).
- Deployment: the live install must pull the new ejabberd image; the old admin password was printed in its log earlier and should be rotated after the deploy (change `SERVICE_PASSWORD_EJABBERDADMIN` in Coolify, restart; the entrypoint then applies it).
