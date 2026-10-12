# Audit: operations and reliability of the live install (2026-10-12)

Docs only. Read from `main` at `428eba640`. No Coolify or production call was made, so
anything that lives only in Coolify's settings is marked **suspected (check: …)**.
Everything else is **confirmed by code/config** (I read the lines cited).
To avoid duplicates I read only the summaries of `docs/audit/security-audit.md` (SEC-1..15) and
`docs/audit/performance-audit.md` (PERF-1..10); where a finding touches one, it says so.

Live setup in short: one Coolify **Application** `zilar-chat` builds
`deploy/coolify/docker-compose.app.yml` from git on every push to a watched path
(postgres, ejabberd, server, web/Caddy), behind Coolify's Traefik. The old Coolify
**Service** (GHCR images) was deleted with its volumes on 2026-10-11.

## 1. Summary (P0 first)

| Id | Sev | Area | One line |
| --- | --- | --- | --- |
| OPS-1 | P0 | Backups | The nightly dump task and the 4 volume backups were set up on the old Service, which was deleted on 10-11; nothing re-created them on the Application. Off-site backups have probably been off since then. |
| OPS-2 | P0 | Monitoring | Nothing alerts on anything, and `/health` checks only Postgres. ejabberd down, push component down, FCM auth failing or a disk filling up all stay green and silent. |
| OPS-3 | P1 | Deploy | Every deploy returns 502/503 for ~30–60 s and drops every client's XMPP WebSocket: compose recreates in place, the health probes are slow, Caddy has no retry, and `/xmpp-ws` runs through the web container. |
| OPS-4 | P1 | Deploy | Possibly every deploy also recreates postgres and ejabberd (Coolify injects per-deploy variables into every service), which drops all XMPP sessions and hibernated push sessions. |
| OPS-5 | P1 | Migrations | A failing migration takes the site down with no rollback. The old server is already gone, the server crash-loops, the documented rollback (`IMAGE_TAG`) no longer exists, and no backup is taken before a deploy. |
| OPS-6 | P1 | Migrations | The migrator silently skips any file numbered at or below the latest applied id. A lower-numbered migration from a parallel branch never runs and gives no error. |
| OPS-7 | P1 | ejabberd schema | ejabberd's own tables are never checked. `update_sql_schema` cannot fix a shape change at the same version, the base image is pinned by tag and not by digest, and the fixes (push_session drop, SEC-4 REVOKE) were manual terminal SQL with no record. |
| OPS-8 | P1 | Logging | Logs live only in the container's json log. Every deploy removes the old container, so logs from before the last deploy are gone, and nothing ships them elsewhere. |
| OPS-9 | P1 | Secrets | Every generated secret exists only in Coolify's database: the key-encryption key, the push storage key, the JWT secret and the DB passwords. No backup covers them. |
| OPS-10 | P1 | Mobile release | The APK is built by hand, signed with the template debug key, carries no versionCode bump, has no OTA updates and no client version check, and needs `google-services.json` copied in by hand. |
| OPS-11 | P1 | Config | The XMPP domain is derived from Coolify's magic `SERVICE_FQDN_WEB`. Editing the domain in Coolify silently renames every account and room. |
| OPS-12 | P1 | Config drift | There are 4 compose variants and 3 ejabberd.yml files. Two are dead but still maintained (T-1140 edited one of them), `RELEASING.md` describes the dead GHCR path, and CI checks none of them. |
| OPS-13 | P1 | Disk | Disk-full has many roads (builds on the live host, local backup copies, dumps inside the DB volume, 4 GiB upload quota per user with no global cap) and no alert. |
| OPS-14 | P1 | Restore | The restore has never been run end to end. The drill restores only `zilar.dump` on the same server; the ejabberd/MAM dump, the volume archives and the secrets have never been restored, and there is no RTO. |
| OPS-15 | P2 | Backups | The off-site copies are plain `pg_dump`/tar archives holding the message archive and sessions, with no client-side encryption. |
| OPS-16 | P2 | Shutdown | The server's force-exit is 15 s, but Docker kills after 10 s. ejabberd has no `stop_grace_period`. |
| OPS-17 | P2 | Logging | The redact list misses several secret names (FCM JSON, VAPID private key, push storage key, JWT secret). |
| OPS-18 | P2 | Deploy | The auto-deploy fires on any push to a watched path (the old path waited for green CI), and the build runs on the live host. |
| OPS-19 | P2 | Disaster | Nothing watches TLS renewal or Coolify itself, and no runbook covers either. |
| OPS-20 | P2 | Backups | The `ejabberd-database` volume (Mnesia, Erlang cookie) is not in the backup list, and nobody has written down what it holds. |
| OPS-21 | P2 | Compatibility | Clients never read `protocolVersion`, so open web tabs and old APKs keep calling a changed API with no "please update" path. |

Counts: **P0 2, P1 12, P2 7.**

## 2. Findings by area

### 2.1 Deploy downtime

**OPS-3 (P1): a deploy is recreate-in-place, so every push shows errors and drops sockets.** Confirmed by config, except where marked.
- Evidence: `deploy/coolify/docker-compose.app.yml:124-128` (server waits for postgres and ejabberd to be healthy), `:251-253` (web waits for server to be healthy), `:228-235` (server probe every 10 s, start_period 30 s), `:260-265` (web probe every 15 s). `apps/web/Caddyfile:44-45` proxies `/api` with a bare `reverse_proxy server:3000` (no `lb_try_duration`). `apps/web/Caddyfile:52-54` sends `/xmpp-ws/ws` through the web container to ejabberd.
- What happens:
  1. Compose stops the old server, starts the new one, which runs its migrations (`apps/server/src/main.ts:256`) and waits for its first probe (≥10 s). Until then the old web's Caddy answers 502 on `/api` at once.
  2. Then the web container is recreated whenever `apps/web` or `packages/*` changed (most pushes). Its Docker layers are keyed on those paths: `apps/web/Dockerfile:21-28`. Traefik's Docker provider drops a container whose health is `starting`, so `chat.zilar.app` answers 503 until the first web probe passes (≥15 s). Suspected (check: Traefik access log during a deploy).
  3. Because the WebSocket goes through the web container, step 2 disconnects every web and mobile client. They all reconnect and replay MAM per chat at once (see PERF-1).
- Getting to near-zero downtime on Coolify, smallest first:
  1. Add `start_interval: 1s` to every healthcheck in `docker-compose.app.yml` (Docker Engine ≥ 25). A new container then turns healthy in ~1–2 s instead of 10–15 s.
  2. In `apps/web/Caddyfile`, add `lb_try_duration 30s` and `lb_try_interval 250ms` to the `/api` and `/xmpp-ws/ws` proxies. Requests then wait for the new server instead of failing with 502.
  3. Route `/xmpp-ws/ws` straight from Traefik to ejabberd (a second Coolify domain/path entry on the ejabberd service), so a web rebuild no longer cuts sockets.
  4. True zero downtime: Coolify does rolling updates only for single-container build packs (Dockerfile/Nixpacks), not for a compose stack. Suspected (check: Coolify docs, "rolling updates"). Splitting web and server into their own Dockerfile Applications, with postgres and ejabberd in a compose Application that has no app watch paths, gives a short window with two servers running side by side. That window has a cost: migrations must be expand/contract, and the XEP-0114 push component (`apps/server/src/push/component.ts:39-43`) is one connection per domain, so the two servers would fight over it. That needs a hand-off design first.

**OPS-4 (P1): ejabberd and postgres may restart on every push.** Suspected (check: `docker inspect -f '{{.State.StartedAt}}'` on the ejabberd and postgres containers against the last deploy time).
- Evidence: `docs/RELEASING.md:39` (observed on the Service: "`env_file: .env` injects ALL stored variables into every container"). With "include source commit" on, `SOURCE_COMMIT` (`docker-compose.app.yml:122`) changes on every deploy. If that variable reaches every service's environment, compose sees a changed config and recreates all four services.
- What happens: an ejabberd restart drops every C2S session. Stream-management resumption and the hibernated sessions that `mod_push_keepalive` keeps (`deploy/ejabberd/ejabberd.yml:252-253,275`) live only in memory. Rooms (`:209`), MAM (`:230`) and `push_session` persist in SQL, so no data is lost. But a phone that is asleep is unreachable until its next session sends `<enable/>` again (T-1152). A postgres restart costs ~5–15 s of 503s on top of OPS-3.
- Fix: if the check confirms it, keep `SOURCE_COMMIT` to the server's build `args` only, as it is now, and have Coolify stop putting it in `.env`. Failing that, split the stack as in OPS-3 step 4.

### 2.2 Migration safety

What works today (confirmed by code): files run in number order (`apps/server/src/effect/sql.ts:178-193`). Each migration commits in its own transaction under `LOCK TABLE … ACCESS EXCLUSIVE` on the journal (`sql.ts:254-281`; effect `Migrator.ts:232,315`). So two servers cannot migrate at the same time, and a failing file rolls back alone while the earlier ones stay committed. Duplicate numbers fail the start (`Migrator.ts:249`).

**OPS-5 (P1): a failing migration means a full outage with no rollback.** Confirmed by code/docs.
- Evidence: `main.ts:256` runs the migrations before the server listens, and an error ends the process. `restart: unless-stopped` (`docker-compose.app.yml:123`) then loops. The web container waits for a healthy server (`:251-253`). The rollback in `docs/RELEASING.md:46,128-132` is "set `IMAGE_TAG`", which the Application does not use (it builds from git). `RELEASING.md:136` says a deploy takes no backup, even with a migration. DDL such as `0047_native_push.sql:1-8` is plain `ALTER TABLE` with no `lock_timeout`; a long lock on a big table would stall every query.
- What happens: a bad SQL file reaches main and Coolify deploys it. The old server is stopped, the new one exits, the site shows 502/503, and the only fix is a forward commit, or a manual restore if the change was destructive.
- Smallest fix:
  1. Write the Application rollback in `RELEASING.md`: `git revert` and push, or Coolify's "redeploy a previous commit". The `IMAGE_TAG` text goes.
  2. Add a "migration in this push" rule: run the dump task and the `postgres-data` backup before merging.
  3. Put `SET lock_timeout = '5s'` at the top of every migration, either through a check in the loader in `sql.ts` or a lint on `apps/server/drizzle/*.sql`.
  4. Write the expand/contract rule in `AGENTS.md`: no drop or rename of a column in the same release that stops using it.

**OPS-6 (P1): a lower-numbered migration that merges late is skipped forever.** Confirmed by code.
- Evidence: `node_modules/.pnpm/effect@4.0.0/node_modules/effect/src/sql/Migrator.ts:258` (`if (currentId <= latestMigrationId) continue`). `migrateSql` only filters by id (`sql.ts:272-276`).
- What happens: branch A adds `0049_*.sql`, merges and deploys. Branch B, started earlier, adds `0048_*.sql` and merges later. Its id is below the latest applied one, so it never runs, and the missing schema change goes unnoticed until a query fails in production.
- Fix: a gate check (a script in `packages/devtools`) that rejects a new `apps/server/drizzle/NNNN_*.sql` unless NNNN is exactly one more than the highest number on `main`. Also log a warning at start when a file on disk is ≤ latest and not in the journal (`sql.ts`, next to `adoptDrizzleJournal`).

**OPS-7 (P1): ejabberd's schema and the cluster-level roles live outside any migration.** Confirmed by code/docs.
- Evidence:
  - `deploy/ejabberd/ejabberd.yml:56-62` (`update_sql_schema: true`), `deploy/ejabberd/Dockerfile:19` (`FROM …:26.07`, a tag), `work/T-1146-ejabberd-push-enable-audit.md:154-158` (push_session shape drift at the same schema version, fixed by hand in the Coolify terminal).
  - `deploy/postgres/init/20-search-reader.sql:42-51`: init scripts run only on an empty volume, so SEC-4's fix needed the manual `REVOKE` in `work/T-1156-deploy-hardening.md:140-141`, and a fresh install needs a manual `GRANT` after ejabberd's first start.
  - Nothing in `apps/server/src` reads ejabberd's `schema_version` or the shape of `push_session`.
- What happens: the next ejabberd tag re-push or minor bump changes a table shape. Push, MUC or MAM breaks with `internal-server-error`, `/health` stays 200, and the owner finds out by testing (as on 10-11).
- Fix:
  1. Pin the image by digest in `deploy/ejabberd/Dockerfile:19` and `infra/docker-compose.dev.yml:45`.
  2. Add a startup check in the server (it already holds `XMPP_ARCHIVE_DATABASE_URL`). It reads `information_schema.columns` for `push_session`, `archive` and `muc_room` and logs an error, plus a flag `/health` shows, when the columns differ from a committed list.
  3. Add `deploy/postgres/ops/NNNN_*.sql`, "cluster changes" run once by hand, and a `docs/OPS_LOG.md` row for each run.

### 2.3 ejabberd lifecycle

Confirmed by config:
- **The config is baked into the image** (`deploy/ejabberd/Dockerfile:21-23`). The push host is written into the container layer at start (`deploy/ejabberd/push-entrypoint.sh:16-18,36-38`), so a recreate starts clean. That is fine.
- **Volumes.** `ejabberd-database` holds Mnesia and `ejabberd-uploads` holds the files (`docker-compose.app.yml:107-109`). With `default_db: sql` (`ejabberd.yml:56`), rooms, MAM, rosters and `push_session` are all in Postgres, so a restart loses only RAM state: sessions, stream-management queues and hibernated push sessions (OPS-4).
- **The health probe** is `ejabberdctl status` (`docker-compose.app.yml:110-115`). It passes while SQL writes fail (the 10-11 push bug), and the server's `depends_on: ejabberd: service_healthy` (`:127-128`) applies only at start.
- **The admin account** is re-registered on every start (`deploy/ejabberd/jwt-entrypoint.sh:66-82`). A failure there is only a log line, and the server's `/api` calls then fail with 401.

### 2.4 Backups and restore

**OPS-1 (P0): the backups probably stopped at the 10-11 cut-over.** Suspected (check: Coolify Scheduled Tasks and the Storages backup schedules on Application `zilar-chat`, plus the date of the newest object in the B2 bucket).
- Evidence: the dump task and volume schedules were made for the Service (`deploy/coolify/scheduled-backup.md:3,19-29`). The cut-over plan copies the volumes but has no step to re-create the task or the schedules (`docs/deploy/coolify-app-plan.md:40-47,52-60`). The lead's notes record the old Service "deleted with its volumes" on 10-11. Coolify ties both scheduled tasks and volume backups to the resource that owns them.
- What happens: a disk loss or a bad migration has nothing newer than 10-11 to restore. Every chat, upload, sticker and avatar since then is gone.
- Fix: re-create on the Application the dump task (exact command at `scheduled-backup.md:44-46`) and the four volume schedules (`:52-57`). Run both once and check B2. Then rewrite `scheduled-backup.md` for an Application (it still says Service and `postgres-<service-uuid>`).

**OPS-14 (P1): the restore is unproven.** Confirmed by docs.
- Evidence: `scheduled-backup.md:77` ("The layout of the volume archives is not checked yet"), and `:104-124`: the drill restores only `zilar.dump`, on the same server, and compares 3 counts. `ejabberd.dump` (MAM, rooms, rosters) has never been restored. `scheduled-backup.md:61,73`: Coolify cannot read back the backup settings.
- Fix: a quarterly drill on a throwaway host. Pull from B2, restore all three dumps and the three file volumes, start the stack with the saved secrets (OPS-9), log in, and open an old chat and an old upload. Write the time it takes as the RTO.

**OPS-15 (P2):** the archives go to B2 as plain dumps and tars. The dump command sets `umask 077` (`scheduled-backup.md:45`), but nothing encrypts on the client side. Suspected (check: B2 bucket encryption and key access). Fix: turn on B2 SSE now. Later, have the dump task pipe through `age` with a public key whose private half sits offline.

**OPS-20 (P2):** `ejabberd-database` is not in the schedule (`scheduled-backup.md:52-57`). Suspected low value (Mnesia leftovers, the Erlang cookie). Fix: write down what it holds, or back it up weekly.

### 2.5 Monitoring and alerting

**OPS-2 (P0): no alerts, and a shallow health check.** Confirmed by code; the Coolify notifications are suspected.
- Evidence:
  - `apps/server/src/app.ts:575-588,594-609`: `/health` runs `select 1` and nothing else.
  - `apps/server/src/push/component.ts:49-53,78-89`: a component error or a failed start is a `warn`.
  - `apps/server/src/push/delivery.ts:62-86`: dropped or failed pushes are `warn` lines, and the IQ is still answered `result`.
  - A grep across `docs`, `deploy` and `apps/server/src` finds no uptime check, metrics, Sentry or alert hook. Docker never restarts an *unhealthy* container, only one that exited.
  - Suspected (check: Coolify Notifications settings): no email or Telegram for failed deployments, failed backups or container status.
- What happens: the scenarios behind P0. The push component cannot authenticate, the FCM key is revoked, ejabberd's SQL writes fail, or a backup fails. Each is silent, and the owner learns of it from users or by testing (as with push on 10-11).
- Fix:
  1. Add `GET /health/deep`, or extend `/health` with fields that do not affect its status code. It reports the push component as online or offline (from `@xmpp/component` `online`/`offline` events in `component.ts`), the time of the last successful FCM send and the last FCM token error, an ejabberd `status` ping, and the schema check from OPS-7.
  2. Run one external uptime monitor that checks both endpoints every minute and alerts by email or Telegram. Uptime Kuma as a Coolify one-click is enough.
  3. Turn on Coolify notifications for deployment failed, backup failed, scheduled task failed, and server disk usage over 80 %.

### 2.6 Logging

Confirmed by code: logs are pino JSON at `LOG_LEVEL` (default `info`, `docker-compose.app.yml:139`), and the request line carries method, path, id, status and duration (`apps/server/src/effect/edge.ts:129-140`). Push logs carry ids only (`delivery.ts:65-82`), and the FCM code keeps tokens and keys out of its errors (`apps/server/src/push/fcm.ts:27-36`, `fcm-token.ts:42-50`). No message text was found in any log call I read.

**OPS-8 (P1): logs do not survive a deploy.** Suspected (check: after a deploy, whether Coolify's log view shows anything from before it). Docker deletes a container's json log when the container is removed, and each deploy replaces the server (and often web and ejabberd). With several deploys a day, an incident is often unreadable a few hours later. Fix: ship the container logs (Coolify's log drain or a Vector/Loki sidecar), or at least set the server's `logging: json-file` with `max-size`/`max-file` and document `docker logs` before a redeploy. Write down the retention.

**OPS-17 (P2):** `apps/server/src/logger.ts:4-26` redacts the generic keys and a few env names, but not `FCM_SERVICE_ACCOUNT_JSON`, `private_key`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_STORAGE_KEY`, `ZILAR_XMPP_JWT_SECRET` or `EJABBERD_ADMIN_PASSWORD`. The risk appears only if a config object is ever logged. Fix: add them to `redactPaths`.

### 2.7 Configuration drift

**OPS-12 (P1): too many deploy files, and the wrong one gets edited.** Confirmed by code.
- **The deploy files:**
  - `deploy/coolify/docker-compose.app.yml` is the live one.
  - `deploy/coolify/docker-compose.yml` is the GHCR Service. That Service was deleted, but the file was still edited by T-1156 (commit `992dd240c`).
  - `deploy/docker-compose.yml` is the self-host stack with Caddy and GHCR images (`:107,231`). T-1140 edited this one believing it was the only compose file (`work/T-1140-compose-fcm-env.md:31`).
  - `deploy/baremetal/*` is a systemd stack. Its `ejabberd.yml:227` lacks `notify_on: messages` (T-1155 is in `deploy/ejabberd/ejabberd.yml:274`).
- **Stale docs and dead CI:**
  - `docs/RELEASING.md:24-26,93-132` still describes the restart-with-`pull_latest` and `IMAGE_TAG` deploy.
  - `.github/workflows/images.yml:284-296` still holds the deploy job, which is now off.
- **No check:** `deploy/tests/*.sh` are not run in CI, and none of them mention `docker-compose.app.yml`.
- **Fix:**
  - Delete `deploy/coolify/docker-compose.yml` and the `deploy` job, and keep `images.yml` for tagged self-host images.
  - Put a "live file" banner at the top of each remaining compose file.
  - Add a gate check that diffs the server `environment:` keys across `docker-compose.app.yml` and `deploy/docker-compose.yml`.
  - Rewrite `RELEASING.md` §3, §6 and §9 for the Application.

**OPS-11 (P1): the XMPP identity hangs on a Coolify magic variable.** Confirmed by config. `docker-compose.app.yml:80-82,102,151-157,209` derive the ejabberd host, MUC host, admin JID and push JID from `SERVICE_FQDN_WEB`. That value had to be set by hand on 10-11, because a domain change did not update it. Any later domain edit, or a Coolify upgrade that regenerates the variable, changes the XMPP domain on the next deploy, and every account, roster and room points to a domain that no longer exists. Fix: one explicit `ZILAR_XMPP_DOMAIN: ${ZILAR_XMPP_DOMAIN:?…}` variable, used everywhere instead of `SERVICE_FQDN_WEB`, plus a server start check that refuses to boot when it differs from the domain stored in the database (store it at first run).

**OPS-9 (P1): the secrets exist in one place.** Suspected (check: whether Coolify's own instance backup is on, and whether an offline copy of the env exists). The generated values (`docker-compose.app.yml:50-54,87-88,97,103,137-159`) live only in Coolify's database. Losing them costs the following:
- `ZILAR_KEY_ENCRYPTION_KEY`: the stored provider keys and the Resend key can no longer be read.
- `PUSH_STORAGE_KEY`: every push device is undecryptable (`delivery.ts:62-69`).
- `BETTER_AUTH_SECRET`: everyone is logged out.
- The DB passwords no longer match the restored roles.

Fix: export the env once (keys and values) into the password manager, and update it on every rotation. The OPS-14 drill uses that copy.

### 2.8 Mobile release pipeline

**OPS-10 (P1): the Android release is a hand-built, debug-signed sideload.** Confirmed by code/docs.
- Evidence:
  - `docs/RELEASING.md:50` says the APK is "signed with the standard debug key". The Expo template's debug keystore is public, so anyone can build an APK that installs over Zilar as an "update" on a sideloaded phone.
  - `RELEASING.md:52-61`: a hand build in a scratch worktree.
  - `apps/mobile/app.config.ts:6-27` and `apps/mobile/.gitignore:37`: `google-services.json` must be present on disk, or FCM is left out without a word.
  - `apps/mobile/app.json:5`: version `0.1.0` and no `versionCode`.
  - `apps/mobile/package.json` has no `expo-updates`.
  - Nothing in `apps/mobile/src` or `apps/web/src` reads `protocolVersion` (`packages/protocol/src/version.ts:1`).
- What happens: a JS fix needs a new 120 MB APK installed by USB. A build without `google-services.json` ships without push and nothing flags it. An old APK cannot tell that it is too old (OPS-21).
- Fix:
  1. Generate a release keystore. Keep it and its passwords in the password manager, plus one offline copy (losing it means users must uninstall to update). Add `signingConfigs.release` through an Expo config plugin.
  2. Bump `android.versionCode` from the git commit count in `app.config.ts`.
  3. Have the build script fail when `google-services.json` is missing for a prod build.
  4. Later: EAS Update or a self-hosted `expo-updates` channel.

**OPS-21 (P2):** the server reports `protocolVersion` in `/health` (`app.ts:583`), but clients never compare it. Fix: add a `minClientProtocol` to `/health` or `/api/me`, and show an "update the app or reload" banner on web and mobile when the client is older.

### 2.9 Disaster scenarios

| Scenario | What happens today | Evidence | Gap |
| --- | --- | --- | --- |
| Disk full (OPS-13, P1) | Postgres stops accepting writes, ejabberd uploads fail, the server's writes fail; `/health` may stay 200 until postgres stops | Coolify builds all 4 images on the live host on each push; 3 local copies per volume (`scheduled-backup.md:29`); dumps sit inside `postgres-data` (`:23`); 4 GiB hard quota per user and no global cap (`ejabberd.yml:194-197,233-251`) | Disk alert (OPS-2), Coolify Docker cleanup threshold, suspected (check: Server → Docker cleanup); a global upload cap |
| Postgres crash | `restart: unless-stopped` brings it back; `/health` is 503 meanwhile | `docker-compose.app.yml:47,57-62` | No alert; a corrupted volume means restoring from dumps (OPS-1, OPS-14) |
| ejabberd crash loop | Chat is down for everyone while `/health` stays 200; push stops | `app.ts:575-588`; `ejabberd.yml` start failures (`push-entrypoint.sh:39-42,50-53` exit 1 by design) | Deep health (OPS-2); a runbook: read logs, roll back the commit |
| Expired TLS (OPS-19, P2) | Browsers and apps refuse to connect | Traefik in Coolify renews Let's Encrypt; nothing in the repo checks it | Certificate-expiry check in the uptime monitor |
| Coolify down (OPS-19) | The running containers keep serving (Traefik is its own container), but there are no deploys, no logs UI and no scheduled backups | Scheduled tasks are Coolify jobs (`scheduled-backup.md:23`) | Runbook: SSH, `docker ps`, `docker logs`, a manual dump |
| Bad deploy | Outage until a forward fix | OPS-5 | Written rollback |

**OPS-16 (P2):** the force-exit is 15 s (`apps/server/src/main.ts:78-79`), but Docker sends SIGKILL after 10 s by default, and no `stop_grace_period` is set in `docker-compose.app.yml`. ejabberd (tini plus `ejabberdctl foreground`, `jwt-entrypoint.sh:88`) also gets only 10 s. Fix: `stop_grace_period: 20s` on server and ejabberd.

**OPS-18 (P2):** the Coolify GitHub App deploys on every push to a watched path, whatever CI says. The old job checked CI first (`images.yml:296`). The lead's local gate lowers the risk, but a direct push skips it. The build also takes CPU and RAM from the live stack. Suspected (check: whether Coolify offers "deploy only after checks pass"). Fix: turn off the Coolify auto-deploy and have a CI job call Coolify's deploy webhook after a green run (the old `deploy` job, pointed at the Application).

## 3. Runbook gaps

None of these exists today:
1. **Rollback a bad deploy** on the Application (revert and push, or redeploy a previous commit), including "the migration already ran".
2. **Restore from B2 onto a new host**: which archive, dump order, volume layout, secrets source, DNS. `scheduled-backup.md:75-102` is Service-era and untested.
3. **ejabberd schema repair**: the 10-11 `push_session` fix as a reusable procedure (check the shape, drop the table and its `schema_version` row, restart, ask web users to re-enable push).
4. **Push is broken**: where to look (component online, FCM token errors, `push_session` errors in the ejabberd log) and how to tell FCM, VAPID and ejabberd failures apart.
5. **Disk full**: what to prune first (build cache, local backup copies, old dumps), and what must never be pruned.
6. **Secret rotation and recovery**: which secrets must match stored state (`docs/deploy/coolify-app-plan.md:36-37`), and what each loss breaks (OPS-9).
7. **Domain change**: what must stay the same so XMPP identities survive (OPS-11).
8. **Mobile release**: keystore location, versionCode rule, Firebase file check, how a user updates.
9. **Coolify unavailable**: operating the stack over SSH.

## 4. Fix plan (impact first, then size)

1. **Restore and verify the backups (OPS-1, OPS-20).** Docs plus Coolify settings, no code. The lead re-creates the dump task and the four volume schedules on `zilar-chat`, runs both once and checks B2. A worker then rewrites `deploy/coolify/scheduled-backup.md` and `docs/RELEASING.md:41,134-142` for the Application. Small.
2. **Alerting and deep health (OPS-2, OPS-13, OPS-19).**
   - Server: add push component online/offline state, last FCM success and error, an ejabberd ping and the OPS-7 schema check to `/health`, without touching its status code (`apps/server/src/app.ts`, `apps/server/src/push/component.ts`).
   - Ops: an uptime monitor with a certificate check, plus Coolify notifications for failed deploys, failed tasks and disk use.

   Medium.
3. **Near-zero-downtime deploy (OPS-3, OPS-16).**
   - In `deploy/coolify/docker-compose.app.yml`: `start_interval: 1s` on every healthcheck, and `stop_grace_period: 20s` on server and ejabberd.
   - In `apps/web/Caddyfile`: `lb_try_duration 30s` and `lb_try_interval 250ms` on `/api` and `/xmpp-ws/ws`.
   - Then check OPS-4 on the host. If postgres and ejabberd restart on every deploy, a follow-up splits the stack.

   Small.
4. **Migration guard rails (OPS-5, OPS-6).** A gate script that rejects a migration number other than max+1 and a missing `lock_timeout` (`packages/devtools`). A start-time warning for skipped files (`apps/server/src/effect/sql.ts`). The expand/contract rule in `AGENTS.md`, and the rollback and pre-migration backup steps in `RELEASING.md`. Small.
5. **ejabberd and cluster drift (OPS-7, OPS-11).** Pin the ejabberd image by digest (`deploy/ejabberd/Dockerfile:19`, `infra/docker-compose.dev.yml:45`). Add a start check that compares the ejabberd table columns and the stored XMPP domain. Add one explicit `ZILAR_XMPP_DOMAIN` in `docker-compose.app.yml`, and a `docs/OPS_LOG.md` for manual SQL. Medium.
6. **Deploy file clean-up (OPS-12, OPS-18).** Delete `deploy/coolify/docker-compose.yml` and the `images.yml` `deploy` job. Add banners, an env-key diff check across the remaining compose files, and fix `baremetal/ejabberd.yml` (`notify_on`). Rewrite `RELEASING.md` §3, §6 and §9. Small.
7. **Logs and secrets (OPS-8, OPS-9, OPS-17).** Log shipping or json-file rotation with a written retention. An offline export of the env into the password manager. The missing names in `apps/server/src/logger.ts:14-26`. Small.
8. **Android release hardening (OPS-10, OPS-21, OPS-14).**
   - Mobile: a release keystore through an Expo config plugin, a `versionCode` from the commit count in `apps/mobile/app.config.ts`, and a hard failure when `google-services.json` is missing for a prod build.
   - Clients: a `minClientProtocol` check with an update banner.
   - Then the first full restore drill on a throwaway host, which writes the RTO into the restore runbook.

   Medium.
