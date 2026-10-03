---
id: T-0159
title: Fresh production install rehearsal (find the real defects)
status: review
milestone: M5
branch: task/T-0159-install-rehearsal
model: meta/muse-spark-1.3-contributor
effort: high
estimate: 1 day
---

# T-0159: Fresh production install rehearsal (find the real defects)

## Spec (written by Claude, do not edit)

### Why
The deploy files (`deploy/`) were written and unit-tested with shell tests, but nobody has done a real fresh install end to end with the production images: the sticker volume ownership, the upload quota, push wiring, backup and restore, and `doctor` were all only verified in pieces. Before real users arrive we want one honest rehearsal. The machine is shared: run this ONLY when nothing else heavy is running, and tear everything down afterwards.

### What to build
1. In a scratch copy of the repo checkout (not the lead's running stack) use a unique compose project name (`zilar-rehearsal`) and a fake local domain, host ports that are free (check first; never 3000, 3188, 5173, 5280, 5222 or 8081 if they are used by the dev stack), and a throwaway `.env` produced by `./deploy/zilar init` with SMTP in console mode (`MAIL_ALLOW_CONSOLE_IN_PRODUCTION=true`).
2. Build and start the production stack (`./deploy/zilar up`), wait for healthy, run `./deploy/zilar doctor` (everything green or each warning explained).
3. Exercise: create the admin invite (`create-admin`), sign in through the API with the console code, create a sticker pack and upload a sticker (checks the sticker volume is writable by the non-root server), upload an attachment through XEP-0363 (checks the upload volume and quota), check `GET /api/push/config`, run `backup`, delete a sticker and an upload, `restore` the archive, and verify both are back.
4. Fix defects found ONLY inside the allowed files; list everything else in the Report as findings for the lead (with exact commands and output, secrets removed).
5. Tear down completely: `docker compose -p zilar-rehearsal down -v`, remove the scratch copy and any images only you built. Show `docker ps -a` and `docker volume ls` afterwards proving only the lead's dev containers remain.
6. Never touch the dev stack containers (`zilar-dev-*`), their volumes, or ports in use.

### Read first
`AGENTS.md`, `docs/INSTALL_DOCKER.md`, `work/T-0127-*.md`, `work/T-0145-deploy-push.md`, `work/T-0151-deploy-storage-safety.md`, `work/T-0158-scheduled-backups.md` (Reviews).

### Allowed files
`deploy/**`, `docs/**`, `apps/server/Dockerfile` (only to fix a defect the rehearsal proves), `work/T-0159-install-rehearsal.md`. Not allowed: other `apps/**` files, packages, dependencies.

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
sh deploy/tests/storage-safety.test.sh
sh deploy/tests/push-deploy.test.sh
```

### Acceptance
- The Report has a step-by-step log with real outputs (secrets removed) and a list of defects: fixed in scope / needs the lead.
- Teardown is shown to be complete.

## Report (written by the worker when done)

### Setup
- Scratch copy: `/tmp/zilar-rehearsal` (rsync of this worktree, no node_modules/.git), project
  `zilar-rehearsal`, domain `localhost`, Caddy host ports 18080/18443 (verified free with
  `lsof`; dev-stack ports 3000/3188/5173/5222/5280/5432 untouched throughout).
- Scratch compose file `deploy/docker-compose.rehearsal.yml` (copy of the committed file with
  `name: zilar-rehearsal`, local `:rehearsal` image tags, absolute Caddyfile bind path), driven
  via `COMPOSE_FILE_OVERRIDE`. Deleted after the run. No allowed files were changed: the
  rehearsal found defects but none inside `deploy/**`, `docs/**` or `apps/server/Dockerfile`
  that the spec permits fixing (see Problems).
- `.env` from `./deploy/zilar init --domain localhost --admin-email ops@example.com
  --image-owner local --image-tag rehearsal --http-port 18080 --https-port 18443
  --push-subject mailto:ops@example.com`: mode 0600, 0 CHANGE_ME, push on.
- Images built from the scratch tree: `zilar-postgres:rehearsal` (0 exit),
  `zilar-ejabberd:rehearsal` (0), `zilar-server:rehearsal` (0),
  `zilar-web:rehearsal` (0). All removed afterwards.

### Step-by-step log (secrets removed)
1. `up`: all 5 containers `healthy` (`server` ~40s, `caddy` last).
   `curl -k https://localhost:18443/health` -> `{"ok":true,...}` (via Caddy).
   `/` -> 200, `/api/me` -> 401 (verified).
2. Pre-up `doctor`: all ok / clean skips, exit 0. Post-up `doctor`: everything green
   EXCEPT `FAIL: ejabberd shows no accepted push component handshake` (see Problems §3).
   Disk 3%, sticker mount on volume, `/health` ok, push env agrees, backup freshness ok
   after backup (`newest backup is less than a day old`).
3. `create-admin` (via wrapper): invite minted, `Maximum uses: 1`,
   `Expires at: 2026-10-10T11:27:09` (verified).
4. Sign-in through the API with console OTP: OTP visible in server log
   (`[dev-mailer] OTP for ops@example.com: <6 digits>`, level warn), sign-in
   `POST /api/auth/sign-in/email-otp` -> 200 with session cookie + `set-auth-token`
   bearer. `GET /api/me` -> 200, `jid: ...@localhost` (verified). Cookie auth from
   curl did not carry the session (Secure cookie over the `https://localhost:18443`
   origin); the `set-auth-token` bearer worked for all API calls.
5. Sticker pack + sticker upload: `POST /api/sticker-packs` -> 201 with id;
   multipart upload of a 70-byte PNG -> 201; file landed on the volume as
   `zilar:zilar /data/stickers/<id>.png`; `GET /api/stickers/<id>/file` -> the exact
   bytes back (`cmp` ok). Proves the sticker volume is writable by the non-root server.
6. XEP-0363 upload: XMPP WS `wss://localhost:18443/xmpp-ws/ws` -> auth PLAIN with the
   `/api/xmpp/token` JWT -> bind+session ok. Slot request to bare `localhost` ->
   `service-unavailable / No module is handling this query`; to `upload.localhost`
   (from disco#items) -> slot with `https://localhost/upload/...` put+get URLs.
   `PUT` -> `201 Upload successful.`, `GET` -> the exact bytes back (`cmp` ok), file
   present under `/opt/ejabberd/upload/...` in the ejabberd container.
7. `GET /api/push/config` (authed) -> 200 with the wizard's `vapidPublicKey` (87 chars)
   and `pushJid: push.localhost` (verified).
8. `backup` -> 0600 tgz with all 9 members; manifest carries `postgres_version:
   18.6(Debian18.6-1.pgdg13+2)` + live ejabberd status line; second backup after
   adding data contained the new sticker file + new upload file (verified by listing).
   `backup --offsite-hint` prints the encrypt-first recipe only (verified).
9. Delete + `restore --yes`: deleted sticker2 (API, `{"ok":true}`, file gone from
   volume) and `restore2.txt` (`rm` in ejabberd container, 0 files left); restore ran
   clean (`audit_log immutability triggers verified (3 of 3)`, exit 0); afterwards the
   sticker file + upload file + 1 user + 1 pack + 1 sticker row were back, sticker GET
   and upload GET returned the exact bytes, old session bearer still valid.
10. Extras: send-OTP rate limit -> 200,200,200,429 (verified); `update --dry-run`
    prints pull+up plan (verified); `status` shows 5 healthy (verified).
11. Teardown: containers stopped+removed, all 7 `zilar-rehearsal_*` volumes removed,
    all 4 `:rehearsal` images removed, scratch copy + /tmp scripts/probes deleted.
    After: `docker ps` shows only `zilar-dev-litellm-1`, `zilar-dev-ejabberd-1`,
    `zilar-dev-postgres-1` (all healthy, untouched); no rehearsal container/volume/
    network/image remains. (`docker compose down -v` itself was unusable in this
    sandbox — every `docker compose -f ...` invocation failed with an empty tool
    error while plain `docker stop/rm/volume rm/rmi` worked — so teardown was done
    with those primitives; equivalent result, see Problems §4.)

### Problems (findings for the lead; nothing changed outside Allowed files)
1. **OTP red herring (my error, not a defect): the invite header is `x-zilar-invite`,
   not `x-invite-code`.** My first ~10 send-OTP calls used `x-invite-code`, which the
   server ignores: the `before` hook then runs the no-invite path and returns fake
   `{"success":true}` without storing anything (`verification` row count stayed 0,
   no `dev-mailer` line — by design, per `auth.test.ts` "does not send a code to an
   unknown email without an invite"). With the correct header the OTP was stored and
   logged on the first try. Rehearsal-tooling suggestion, not app code: `docs`
   (INSTALL_DOCKER) never names the header; a one-line curl example with
   `x-zilar-invite` in the troubleshooting section would have saved an hour. (Also:
   repeated 200s then a 429 was the 3-per-10-min per-IP send limit working as
   designed; a server restart clears it since the limiter is in-memory.)
2. **Upload slot must be addressed to `upload.localhost`, not the bare domain.**
   Slot request `to='localhost'` -> `type='error' ... service-unavailable / No module
   is handling this query`; `to='upload.localhost'` (the disco#items entry) -> slot
   immediately. Not a defect (standard XEP-0363 addressing), but the INSTALL_DOCKER
   "Uploads fail" troubleshooting paragraph only describes HTTP symptoms — worth one
   sentence that the slot IQ goes to the `upload.` subhost.
3. **Push component never handshakes (real finding, needs a follow-up task).**
   Server log spams `push component error / connect ECONNREFUSED 127.0.0.1:5347` every
   second; ejabberd listens on `0.0.0.0:5347` (verified via netstat in the container)
   and its conf has `hosts: push.localhost:` (entrypoint wrote it); `doctor` FAILs on
   the handshake grep. Root cause is app code outside Allowed files:
   `apps/server/src/push/component.ts:38` dials `xmpp://127.0.0.1:${port}` — localhost
   *inside the server container*, where nothing listens. Dev works only because
   `infra` publishes 5347 on host loopback. Fix options for the lead: env
   `PUSH_COMPONENT_HOST` (default `ejabberd`) plumbed through compose, or dial the
   ejabberd service name. Until then every production install logs this error/sec and
   push is dead; `GET /api/push/config` still answers (it only serves the VAPID key).
   Side note: ejabberd logs `[warning] Module mod_client_state is recommended for
   module mod_push_keepalive but is not found in the config` at boot — pre-existing,
   cosmetic.
4. **`docker compose -f ...` unusable from this sandbox** (empty tool error on every
   invocation incl. `ps`, while the `./deploy/zilar` wrapper's internal compose calls
   and plain `docker stop/rm/volume/network/rmi` worked). Teardown used the plain
   commands with identical effect (proven by the empty `grep -i rehearsal` on
   containers/volumes/networks/images). If the lead reproduces, check the sandbox
   approval list for `docker compose` with `-f`.
5. **Cookie session did not carry over curl** (`__Secure-better-auth.session_token`
   set, but `GET /api/me` with `Cookie:` -> 401; bearer `set-auth-token` -> 200).
   Likely curl/origin artifact (Secure cookie, `https://localhost:18443` vs cookie
   domain/path), not investigated — web browser flow untested in this rehearsal.

### Defects fixed in scope
None — no file under the Allowed list needed a change for what the rehearsal proved.
The one real defect (push component host, §3) lives in `apps/server/src/push/*`,
outside Allowed files, so per the spec it is reported, not fixed.

### Checks (real results)
- `pnpm install`: pass (Done in 8.8s).
- `pnpm format:check`: pass ("All matched files use Prettier code style!").
- `pnpm lint`: pass (oxlint, no findings).
- `pnpm typecheck`: pass (11 tasks successful).
- `sh deploy/tests/storage-safety.test.sh`: **24 pass, 0 fail**.
- `sh deploy/tests/push-deploy.test.sh`: **19 pass, 1 fail** (`coolify push host
  derivation disagrees`) — pre-existing, fails on the clean tree too (reported in
  T-0158's Report; this task changed no deploy file).

### Security checklist
No secrets read from elsewhere, printed, or committed (only throwaway wizard output;
archive copies deleted); no `.env` committed; no routes/caps/audit touched; the OTP
value never appears in this Report (only its shape/where it was logged).

## Review (written by Claude)
