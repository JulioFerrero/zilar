---
id: T-1179
title: "OPS-16 + OPS-17: the log redaction list covers every server secret (FCM JSON, private_key, VAPID private key, push storage key, XMPP JWT secret, ejabberd admin password); server and ejabberd get stop_grace_period 20s so a graceful stop is not SIGKILLed at 10 s"
status: merged
milestone: M5
branch: task/T-1179-log-redaction-and-grace
model: auto
effort: default
depends_on: []
estimate: 0.1 day
---

# T-1179: Redact every secret, give shutdown time

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ops-reliability-audit.md` OPS-16 and OPS-17 (P2).
- **OPS-17:** `apps/server/src/logger.ts:4-26` redacts the generic keys and a few env names, but not `FCM_SERVICE_ACCOUNT_JSON`, `private_key`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_STORAGE_KEY`, `ZILAR_XMPP_JWT_SECRET` or `EJABBERD_ADMIN_PASSWORD`.
- **OPS-16:**
  - the server's force-exit is 15 s (`apps/server/src/main.ts:79`), but Docker kills after 10 s by default;
  - no `stop_grace_period` is set for `server` (`deploy/coolify/docker-compose.app.yml:117`) or `ejabberd` (`:64`), and the same goes for the self-host `deploy/docker-compose.yml:58,106`;
  - the AI drain (T-1168) needs up to 8 s inside that window.

### What to build
1. **`logger.ts`:**
   - add `private_key` and `privateKey` to `SENSITIVE_KEYS`;
   - add these env names to `redactPaths`: `FCM_SERVICE_ACCOUNT_JSON`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_STORAGE_KEY`, `ZILAR_XMPP_JWT_SECRET`, `EJABBERD_ADMIN_PASSWORD` and `LITELLM_MASTER_KEY`. Grep `apps/server/src/config.ts` for any other secret env names, add them, and list them in the Report.
2. **The compose files:** `stop_grace_period: 20s` on `server` and `ejabberd` in both `deploy/coolify/docker-compose.app.yml` and `deploy/docker-compose.yml`. Change nothing else in them.
3. **Test** (keys), 1, in a new `apps/server/src/logger.test.ts`: logging an object holding each new key, both at the top level and nested one level, writes `[Redacted]` and never the value. Use the `destination` parameter of `createLogger` (`logger.ts:28`).

### Read first
`AGENTS.md`, `docs/audit/ops-reliability-audit.md` (OPS-16, OPS-17), `apps/server/src/logger.ts`, `apps/server/src/config.ts`, `deploy/coolify/docker-compose.app.yml:60-130` and `deploy/docker-compose.yml:50-120`.

### Allowed files
`apps/server/src/logger.ts`, `apps/server/src/logger.test.ts`, `deploy/coolify/docker-compose.app.yml`, `deploy/docker-compose.yml`, `work/T-1179-log-redaction-and-grace.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/logger.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/logger.ts`
  - Added `private_key` and `privateKey` to `SENSITIVE_KEYS`.
  - Split the env names into a `SENSITIVE_ENV_KEYS` list and now redact each one at the top level **and** one level deep (previously top level only), so the new names are covered when nested too.
  - Added the six names from the spec: `FCM_SERVICE_ACCOUNT_JSON`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_STORAGE_KEY`, `ZILAR_XMPP_JWT_SECRET`, `EJABBERD_ADMIN_PASSWORD`, `LITELLM_MASTER_KEY`.
  - Added the other secret env names found by grepping `apps/server/src/config.ts`: `GITHUB_APP_PRIVATE_KEY`, `XMPP_ARCHIVE_DATABASE_URL`. Already listed before: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ZILAR_KEY_ENCRYPTION_KEY`, `GIF_API_KEY`, `TELEGRAM_BOT_TOKEN`, `SMTP_USER`, `SMTP_PASSWORD`.
- New `apps/server/src/logger.test.ts`: for each new key it logs the value at the top level and one level deep through `createLogger(loadServerConfig(...), destination)` and asserts the sentinel is absent and two `[redacted]` markers were written.
- `stop_grace_period: 20s` on `server` and `ejabberd` in both `deploy/coolify/docker-compose.app.yml` and `deploy/docker-compose.yml`. Nothing else changed in those files.

### Files changed
- `apps/server/src/logger.ts`
- `apps/server/src/logger.test.ts` (new)
- `deploy/coolify/docker-compose.app.yml`
- `deploy/docker-compose.yml`
- `work/T-1179-log-redaction-and-grace.md`

### Commands and results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/logger.test.ts` → `1 passed (1)` test file, `10 passed (10)` tests.
- `pnpm gate` → `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`; `scope: every changed file is inside the Allowed files`; ends with `GATE PASS`.

### Deviations / notes
- The spec's test wording writes the marker as `[Redacted]`. The logger already censors with `[redacted]`, the same marker every other redaction helper in the repo uses, so I did not change the censor string and the test asserts `[redacted]`. Tell me if you want the censor changed to `[Redacted]`.
- Nested (`*.NAME`) coverage now applies to every env name, not only the new ones; this is what makes the "nested one level" test pass for env names. No existing coverage was removed.
- I added `GITHUB_APP_PRIVATE_KEY` and `XMPP_ARCHIVE_DATABASE_URL` because both are secrets in `config.ts`; the spec asked for any other secret env names found there.

### Open questions
- `PUSH_COMPONENT_SECRET` (`apps/server/src/push/config.ts:44`) is a server secret, but it is neither in the spec's enumerated list nor in `config.ts` (the file the spec said to grep), so I left it out. Add it? **Resolved in Round 2 — added.**

### Round 2 (fix round)
- **Finding 1 (should-fix) — `PUSH_COMPONENT_SECRET` unredacted:** added `'PUSH_COMPONENT_SECRET'` to `SENSITIVE_ENV_KEYS` in `apps/server/src/logger.ts` and a matching case to `NEW_KEYS` in `apps/server/src/logger.test.ts`. Commit `T-1179: fix finding 1 - redact PUSH_COMPONENT_SECRET`.
- **Finding 2 (nit):** no action, as the finding itself states (keeping the existing `[redacted]` marker is correct).
- **Tests added:** one `NEW_KEYS` case, so `logger.test.ts` now covers `PUSH_COMPONENT_SECRET` at the top level and nested one level.
- **Single test:** `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/logger.test.ts` → `1 passed (1)` file, `11 passed (11)` tests.
- **Gate:** `pnpm gate` → `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`; `scope: every changed file is inside the Allowed files`; ends `GATE PASS`.

### Disagreements
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Clean after 1 auto round, with 1 nit.**
- **Redaction:** `private_key` and `privateKey` were added to the generic keys, and nine secret env names are redacted at the top level and one level deep: `LITELLM_MASTER_KEY`, `GITHUB_APP_PRIVATE_KEY`, `XMPP_ARCHIVE_DATABASE_URL`, `FCM_SERVICE_ACCOUNT_JSON`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_STORAGE_KEY`, `PUSH_COMPONENT_SECRET`, `ZILAR_XMPP_JWT_SECRET` and `EJABBERD_ADMIN_PASSWORD`.
- **Compose:** `stop_grace_period: 20s` on server and ejabberd, in both compose files.
- **Tests:** `logger.test.ts`, 11 of 11 in the branch, run by the lead.
