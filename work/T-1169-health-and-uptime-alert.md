---
id: T-1169
title: "OPS-2 (P0): /health also reports ejabberd (admin ping), the push component (online/offline) and the last push send/failure, without changing its status code; a scheduled GitHub workflow checks it every 10 min and fails (GitHub emails the owner) when something is down"
status: merged
milestone: M5
branch: task/T-1169-health-and-uptime-alert
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1169: Deeper health and an uptime alert

## Spec (written by Claude, do not edit)

### Why
`docs/audit/ops-reliability-audit.md` OPS-2 (P0): nothing alerts on anything. The owner found out push was broken on 10-11 only by testing.
- **`/health` checks only Postgres:** `apps/server/src/app.ts:582-597` builds it, and `isDatabaseUp` is at `:604-620`. `app.ts` is 633 lines, over the 400-line rule, so new code goes in a new file and `app.ts` must shrink, not grow.
- **The push component's errors are only logs:**
  - `apps/server/src/push/component.ts:49-53` (an `error`) and `:78-89` (a failed start) are `warn` lines;
  - delivery failures are `warn` lines too (`apps/server/src/push/delivery.ts:62-87`), and `outcome.kind === 'sent'` is at `:90`.
- **No ejabberd status call:** the admin client (`apps/server/src/xmpp/admin/types.ts:44-80`) has none, but `userExists(localpart)` is a cheap round trip.
- **Workflows:** `.github/workflows/` holds `ci.yml`, `code-map.yml` and `images.yml`. The repo is public, so scheduled workflows are free, and GitHub emails the owner when a scheduled run fails.

### What to build
1. **A new `apps/server/src/health-status.ts`:** a small module-level registry (one process) with:
   - `markPushOnline()` and `markPushOffline(reason)`;
   - `markPushSent()` and `markPushFailed(kind)`;
   - `healthSnapshot()`, which returns `{ push: 'online' | 'offline' | 'unknown', lastPushSentAt?, lastPushFailure?: { at, kind } }`.
   It holds no secrets.
2. **`component.ts`:**
   - call `markPushOnline` on the `@xmpp/component` `online` event;
   - call `markPushOffline` on `offline`, on `error` and on a failed start (`:49-53`, `:78-89`).
   Keep the warn lines.
3. **`delivery.ts`:** call `markPushSent()` when the outcome is `sent` (`:90`), and `markPushFailed(kind)` in the `SendFailed` and `ArchiveUnavailable` branches.
4. **A new `apps/server/src/health.ts`:**
   - move `isDatabaseUp` and the body builder out of `app.ts`;
   - add `ejabberd: 'ok' | 'down'`, from `adminClient.userExists('zilar-health-probe')` with a 2 s timeout. Any answer means ok, a throw or timeout means down. Cache the result for 15 s, so the Coolify healthcheck doesn't hammer it;
   - add the `healthSnapshot()` fields.
   - **The status code stays 200 or 503 by the DB only,** as today. The new fields never make the container unhealthy.
   - `app.ts` calls the new builder and gets shorter.
5. **A new `.github/workflows/uptime.yml`:**
   - schedule `*/10 * * * *` plus `workflow_dispatch`;
   - one job: `curl -fsS --max-time 15 https://chat.zilar.app/health`, then fail when `.ok != true`, `.ejabberd != "ok"` or `.push != "online"`, using `jq`, and print the JSON;
   - no secrets, no checkout needed.
6. **Tests:** none. This is ops code, not one of the crucial areas.

### Read first
`AGENTS.md`, `docs/audit/ops-reliability-audit.md` (OPS-2), `apps/server/src/app.ts:560-633`, `apps/server/src/push/component.ts`, `apps/server/src/push/delivery.ts:50-95`, `apps/server/src/xmpp/admin/types.ts:44-80` and `.github/workflows/code-map.yml`.

### Allowed files
`apps/server/src/health-status.ts`, `apps/server/src/health.ts`, `apps/server/src/app.ts`, `apps/server/src/push/component.ts`, `apps/server/src/push/delivery.ts`, `.github/workflows/uptime.yml`, `work/T-1169-health-and-uptime-alert.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `app.ts` is shorter than 633 lines.
- **The lead's check after the deploy:** `/health` shows `ejabberd: "ok"` and `push: "online"`, and one manual `workflow_dispatch` run of `uptime.yml` is green.

---

## Report (written by the worker when done)

### What I did
- **New `apps/server/src/health-status.ts`:** module-level registry with
  `markPushOnline()`, `markPushOffline(reason)`, `markPushSent()`,
  `markPushFailed(kind)` and `healthSnapshot()` returning
  `{ push, lastPushSentAt?, lastPushFailure?: { at, kind } }`. Holds no secrets.
- **`apps/server/src/push/component.ts`:** `markPushOnline()` on the `online`
  event; `markPushOffline('offline')` on `offline`, `markPushOffline('error')`
  in the existing `error` listener and `markPushOffline('start-failed')` in the
  failed-start catch. Both warn lines are kept unchanged.
- **`apps/server/src/push/delivery.ts`:** `markPushSent()` when the outcome is
  `sent`; `markPushFailed('archive-unavailable')` and
  `markPushFailed('send-failed')` in those two catch branches.
- **New `apps/server/src/health.ts`:** `isDatabaseUp` and the body builder moved
  out of `app.ts`; added the `ejabberd: 'ok' | 'down'` field from
  `adminClient.userExists('zilar-health-probe')` with a 2 s timeout (any answer
  is ok; throw/timeout is down), cached for 15 s, and the `healthSnapshot()`
  fields. The status code is still 200/503 by Postgres only.
- **`apps/server/src/app.ts`:** calls `createHealthCheck({ db, adminClient })`;
  removed the moved code and now-unused imports. It shrank from 633 to 584 lines.
- **New `.github/workflows/uptime.yml`:** `schedule: '*/10 * * * *'` plus
  `workflow_dispatch`, one job that runs
  `curl -fsS --max-time 15 https://chat.zilar.app/health`, prints the JSON with
  `jq` and fails when `.ok != true`, `.ejabberd != "ok"` or `.push != "online"`.
  No secrets, no checkout.

Files changed: `apps/server/src/health-status.ts` (new),
`apps/server/src/health.ts` (new), `apps/server/src/app.ts`,
`apps/server/src/push/component.ts`, `apps/server/src/push/delivery.ts`,
`.github/workflows/uptime.yml` (new), this task file.

### Commands and results
Single tests (while working):
`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/delivery.test.ts src/authz-sweep.test.ts`
→ `Test Files 2 passed (2)`, `Tests 12 passed (12)`.

`pnpm gate` (repo root, after `pnpm install`):
```
gate: 7 changed file(s) against main
PASS  install (frozen)  (11.1s)
PASS  format  (2.3s)
PASS  lint  (4.3s)
PASS  typecheck  (5.5s)
PASS  effect  (2.9s)
PASS  tests @zilar/server  (16.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes
- **`markPushOffline(reason)`:** the reason is recorded in the registry's
  internal state but deliberately not part of `healthSnapshot()`, per the spec's
  snapshot shape and its "it holds no secrets" rule — `/health` is public, so it
  must not carry internal error text. For the same reason the call sites pass
  fixed labels (`'offline'`, `'error'`, `'start-failed'`), while the existing
  warn lines keep the raw error message server-side.
- **No tests added**, as the spec says this is ops code, not one of the crucial
  areas.
- I did not run against production; the lead's post-deploy check
  (`/health` shows `ejabberd: "ok"` and `push: "online"`, plus one green manual
  `workflow_dispatch` run) covers that.

### Fix round (lead review)
- **`component.ts`:** no longer marks push offline on the `error` event (it is
  not fatal). Liveness now comes from the `status` event — `online` → online;
  `disconnect` / `offline` / `disconnecting` → offline with that status as the
  reason. The `error` listener keeps only the warn log;
  `markPushOffline('start-failed')` is unchanged. The separate `online`/`offline`
  listeners were removed because `status` already carries both (redundant, not
  conflicting).
  - The hand-written `@xmpp/component` stub
    (`apps/server/src/push/xmpp-component.d.ts`) does not list the `status`
    event and is outside this task's Allowed files, so `component.ts` narrows
    the emitter with a small local type instead of widening the stub.
- **`uptime.yml`:** up to 3 attempts 60 s apart; each attempt prints its JSON
  (or the curl error) and the job fails only when all 3 are unhealthy
  (`ok != true`, `ejabberd != "ok"` or `push != "online"`). `timeout-minutes: 5`
  kept.
- `pnpm gate` after each item: both runs ended `GATE PASS` (7 changed files, all
  inside the Allowed files). Commits: `aacb3db71` (item 1), `761cba392` (item 2).

### Open questions
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after the lead's fix round. The pre-review is clean, with 2 nits.**
- **`/health`** keeps its 200 or 503 by the DB, and adds:
  - `ejabberd` (`userExists` probe, 2 s timeout, 15 s cache);
  - `push`, from the `@xmpp/component` `status` event (online, disconnect, offline);
  - `lastPushSentAt` and `lastPushFailure`.
  `health.ts` holds it, and `app.ts` went from 633 to 583 lines.
- **Lead fix round:**
  1. a non-fatal `error` no longer marks push offline;
  2. `uptime.yml` probes 3 times, 60 s apart, before failing, so a deploy's 502 window doesn't email.
- **Still to do:** after the deploy, `/health` shows `ejabberd: ok` and `push: online`, and one manual `workflow_dispatch` run of Uptime is green.
