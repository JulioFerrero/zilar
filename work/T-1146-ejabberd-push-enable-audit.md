---
id: T-1146
title: "Audit: why XEP-0357 <enable/> to ejabberd answers internal-server-error in production, so no real message ever triggers push (web and Android); reproduce on the local stack, read the ejabberd log, write the cause and the fix"
status: merged
milestone: M5
branch: task/T-1146-ejabberd-push-enable-audit
model: auto
effort: default
depends_on: [T-1145]
estimate: 0.3 day
---

# T-1146: ejabberd push enable fails

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, live on chat.zilar.app (push switched on today: `PUSH_ENABLED=true`, VAPID keys and storage key set in Coolify):
- **Phone Firefox:** Enable, then "Send test" shows a notification. the contract's `push.test` endpoint (`packages/api-contract/src/push.ts:161`) sends straight from the server, so the VAPID keys, the Web Push sender and the push service all work.
- **Real messages from another account never notify,** on web or on Android.
- **The Android app's log** (the lead read it with adb) shows that `POST /api/push/subscriptions` succeeds. The next step, the XMPP `<enable jid="push.chat.zilar.app" node="…"/>` sent over the user's own session (`setPushEnabled`, `packages/xmpp-core/src/core-effect/operations.ts:87`), fails with `IqFailed: internal-server-error` from ejabberd.

  Without a push session in ejabberd, `mod_push` never sends the publish IQ to our component, so no real message is ever pushed. Web uses the same `setPushPair` → `setPushEnabled` step (`apps/web/src/store/effects/pins.ts:107-118`).

**What the lead read:**
- **The production ejabberd:** `deploy/ejabberd/ejabberd.yml` has `default_db: sql`, `sql_type: pgsql`, `update_sql_schema: true` (`:56-62`), `mod_push` with `include_sender` and `include_body` false, and `mod_push_keepalive` (`:270-273`). Its component listener is `push.<domain>` (`:111-116`), with the secret `SERVICE_PASSWORD_PUSHCOMPONENT` (`deploy/coolify/docker-compose.app.yml:96`, `:202`). The image comes from `deploy/ejabberd/Dockerfile`.
- **Local dev** uses `infra/ejabberd/ejabberd.yml`, with the same `mod_push` block (`:216-219`) and `default_db: sql`. Run it with `pnpm infra:up`. The local server `.env` has `PUSH_ENABLED=true`.
- **The lead can't read production container logs:** the Coolify MCP shows only caddy.

### What to do
1. **Reproduce locally.**
   - Start the stack (`pnpm infra:up`, then `pnpm --filter @zilar/server dev` with `MAIL_TRANSPORT=console`).
   - Send the same `<enable/>` IQ from a real user session. Use any way you like: a throwaway script in `/tmp` using `@xmpp/client` or `packages/xmpp-core`, with a local test user from the dev DB (an OTP from the server log), or an `ejabberdctl` / `mod_http_api` call.
   - Read `docker logs zilar-dev-ejabberd-1` around the IQ.
   - **Don't commit the script.**
2. **If it reproduces:** find the cause in the ejabberd log, for example:
   - a missing `push_session` SQL table, or a schema `update_sql_schema` didn't create;
   - a missing module or an option `mod_push` needs;
   - the push JID being refused.
3. **If it does not reproduce:** list every difference between `infra/ejabberd/ejabberd.yml` with the dev compose and `deploy/ejabberd/ejabberd.yml` with `deploy/ejabberd/Dockerfile` and the Coolify compose: the ejabberd version, the SQL schema init in `deploy/postgres/`, the hosts, the listener and the module options. Rank them by how likely each one is to cause `internal-server-error` on enable.
4. **Write `docs/audit/ejabberd-push-enable.md`** with:
   - the exact ejabberd log lines (no secrets);
   - the cause, with evidence;
   - the smallest fix (config, schema or code) as exact file and line changes for a follow-up task;
   - how to verify it on production.
5. **No code or config change** in this task, only the doc. Stop the local server when done.

### Read first
`AGENTS.md`, `deploy/ejabberd/ejabberd.yml`, `deploy/ejabberd/Dockerfile`, `deploy/ejabberd/push-entrypoint.sh`, `deploy/coolify/docker-compose.app.yml:60-120`, `infra/ejabberd/ejabberd.yml`, `infra/docker-compose.dev.yml`, `packages/xmpp-core/src/core-effect/operations.ts:80-110` and `docs/PUSH_SPIKE.md`.

### Allowed files
`docs/audit/ejabberd-push-enable.md`, `work/T-1146-ejabberd-push-enable-audit.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The doc exists, with the log evidence and a concrete fix.
- The gate passes.

---

## Report (written by the worker when done)

**Status:** done. Docs-only audit, no code/config change.

### What I did
- Reproduced the XEP-0357 `<enable/>` step on the local stack with a throwaway
  script (devtools package, deleted, not committed) using the repo's own
  `issueXmppToken` + `@xmpp/client` login. Local answer: **`result`** — it does
  **not** reproduce.
- Traced `internal-server-error` to its only source in `mod_push` (26.07):
  `{error, db_failure}` from the SQL write into `push_session`.
- Inspected the local `push_session` table (single-host shape, no `server_host`)
  and the running build's two query shapes (single-host vs multi-host, chosen at
  compile time by `sql_schema_multihost`), and proved the multi-host query fails
  against the local table while a correctly-shaped table accepts it.
- Read `ejabberd_sql_schema:update_schema/3` and confirmed why
  `update_sql_schema` never migrates this table (schema version 1 in both
  shapes).
- Compared the local and production stacks: same ejabberd image digest
  (`sha256:5aeb0faa…`, checked against the registry) and the same push config;
  the Coolify MCP exposes only the web/Caddy container logs, so production's
  `push_session` could not be read directly (marked **unverified** in the doc).
- Wrote `docs/audit/ejabberd-push-enable.md` with the log evidence, the
  mechanism, the ranked differences, the smallest fix (reset the table + its
  `schema_version` row, restart; the build recreates the correct shape) and the
  production verification steps.

### Files changed
- `docs/audit/ejabberd-push-enable.md` (new)
- `work/T-1146-ejabberd-push-enable-audit.md` (status + this Report)

### Commands and real results
- `pnpm install` — done, no errors.
- Throwaway enable script against the local stack → `enable answer from
  ejabberd: result`; `docker logs zilar-dev-ejabberd-1` shows `Enabling push
  notifications for …` (both quoted in the doc).
- Read-only psql: multi-host `SELECT` against the local `push_session` →
  `ERROR: column "server_host" does not exist`; a scratch-schema table with
  `server_host` accepted the multi-host upsert (scratch schema dropped).
- `pnpm gate` (from repo root):
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- The local stack did **not** reproduce the production failure, so per the
  spec's step 3 the doc gives the difference analysis and ranks the candidate
  causes; the production `push_session` shape itself is not directly observed.
- I did not start or stop a server process: the shared `zilar-dev` infra was
  already running and is used by other worktrees, so I left it up (only the
  throwaway client was run). The throwaway script and the temporary `infra/.env`
  symlink I created to run it were removed before the gate.
- I left one throwaway test user (`push-repro-…`) and its `push_session` row in
  the local dev DB (harmless dev data).
- No secrets were read or printed; the JWT/admin password stayed inside the
  tooling.

### Open question
- Production's `push_session` shape must be read from the production DB (query
  in the doc §8) before applying the fix; I could not reach it through the
  Coolify MCP.

### Round (fix round 1, 2026-10-11)

- Findings fixed: **finding 1 (should-fix)** — §7 no longer claims push
  registrations are universally transient. It now says only mobile re-enables
  on its own (per-session registration in
  `apps/mobile/src/store/chat-store-provider.tsx:142-157` + next-launch retry
  in `apps/mobile/src/lib/push/native.ts:94-99`), and that after a restart every
  **web** user must revisit Notifications and click Enable again (the only entry
  point is the manual button, `apps/web/src/routes/NotificationsPage.tsx:121`).
  §8 step 2 carries the same caveat.
- Finding 2 (nit, table row at §5): left as is, per the rule not to touch nits
  outside lines already changed. No disagreement with it.
- Tests added: none. This is a docs-only change with no code or behaviour, so
  no test applies (the finding names none).
- Gate result: `GATE PASS` (2 changed files, both in Allowed files).

## Review (written by Claude)


**Lead, 2026-10-11: approved. Clean after 1 auto round; 3 nits.**
- **The cause:** `mod_push` answers `internal-server-error` only on `{error, db_failure}` from its `push_session` write. Production's table doesn't match the shape this single-host 26.07 build writes, and `update_sql_schema` can't migrate it, because the version is 1 in both shapes.
- **Local:** the local stack does not reproduce it; a real enable gives `result`, with the log line.
- **The fix** (Julio, in the Coolify terminal):
  - drop `push_session`;
  - delete its `schema_version` row;
  - restart ejabberd.
- **The fix round's catch:** web has no automatic re-enable, so web users must click Enable again; Android re-enables on the next session.
- **Follow-ups:** pin the ejabberd image by digest; add a deploy check; consider a web re-enable at session start.
