---
id: T-0167
title: Keep the ejabberd admin password out of the container logs
status: planned
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

## Review (written by Claude)
