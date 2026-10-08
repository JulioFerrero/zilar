---
id: T-0640
title: "Hono: retire the routines item-11 wrapper (routines/routes.ts); service.test.ts's buildRoutesHarness calls createRoutinesApi(...).handler with a silent logger and the same audit; delete the wrapper; same assertions"
status: merged
milestone: M5
branch: task/T-0640-retire-routines-hono-wrapper
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0640: retire the routines Hono wrapper

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A6 in the T-0626 last-mile audit. T-0637, T-0638 and T-0639 do the same for drafts, files and connections.

### Verified facts (do not re-derive)
- **`apps/server/src/routines/routes.ts`** (49 lines) imports `Hono`. Its `createRoutinesRoutes(deps)`:
  - builds `createRoutinesApi({ ...deps, logger: <silent pino> })`;
  - mounts it on a Hono sub-app with `/api` stripped.
- **The only importer** is `apps/server/src/routines/service.test.ts:31`.
- **`createRoutinesApi(deps)`** (`apps/server/src/routines/api.ts:159`) needs a `logger: Logger` (`api.ts:145`). It returns an `EffectApiMount` whose `handler` takes a `Request` with the full `/api/...` URL.
- **The test's `buildRoutesHarness(context)`** (151-162):
  - builds a Hono app with an `onError` that renders `HttpError`;
  - mounts the wrapper under `/api` with `{ auth, db, audit }`, where `audit` is `createAuditRecorder({ db, now: () => NOW })`;
  - the harness is called as `app.request(`${TEST_BASE_URL}/api/...`, init)` about 20 times, with full URLs.

### What to build
1. **In `service.test.ts`:**
   - make `buildRoutesHarness` return `{ request(url, init) }` that calls `createRoutinesApi({ auth, db, audit, logger: pino({ level: 'silent' }) }).handler(new Request(url, init))`;
   - update the `app` variable's type (`let app: Hono`, around 167);
   - drop the Hono `onError` and remove the imports that are now unused;
   - every assertion stays. If one fails only because of error rendering, stop and report it in Blocked.
2. **Delete** `apps/server/src/routines/routes.ts`. Then `git grep -n "routines/routes" apps` must show nothing.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` item 11, `apps/server/src/routines/routes.ts`, `apps/server/src/routines/service.test.ts` (lines 1-40 and 140-230), `apps/server/src/routines/api.ts` (lines 140-165).

### Allowed files
`apps/server/src/routines/routes.ts`, `apps/server/src/routines/service.test.ts`, `work/T-0640-retire-routines-hono-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/service
pnpm gate
```

### Acceptance
- `routines/routes.ts` is gone, and the routines tests pass with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/routines/service.test.ts`:
  - rewrote `buildRoutesHarness(context)` to return `{ request(url, init) }` backed by `createRoutinesApi({ auth, db, audit, logger: pino({ level: 'silent' }) }).handler(new Request(url, init))` (the `T-0637` drafts pattern);
  - removed the local Hono app and its `onError`, and the now-unused `Hono`, `HttpError` and `createRoutinesRoutes` imports; added `pino` and `createRoutinesApi` imports;
  - changed `let app: Hono` to `let app: ReturnType<typeof buildRoutesHarness>`.
  - Every assertion is unchanged.
- Deleted `apps/server/src/routines/routes.ts` (`git rm`). No code imports it any more.

### Files changed
- `apps/server/src/routines/routes.ts` (deleted)
- `apps/server/src/routines/service.test.ts` (edited)
- `work/T-0640-retire-routines-hono-wrapper.md` (status + this report)

### Commands run (real results)
- `pnpm install` → Done in 13.7s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/service` → `Test Files 1 passed (1)`, `Tests 19 passed (19)`.
- `pnpm gate` (from repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (30.4s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.7s)
  PASS  tests @zilar/server  (33.5s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- `git grep -n "routines/routes" apps` → only two stale doc comments remain; no code imports the deleted module:
  - `apps/mobile/src/lib/tools-api.ts:11` — "The wire contract lives in `apps/server/src/tools/routes.ts` and `apps/server/src/routines/routes.ts`."
  - `apps/web/src/lib/tools.ts:3` — "The wire contract lives in apps/server/src/tools/routes.ts and apps/server/src/routines/routes.ts."
  Per the lead's clarification these stay (outside Allowed files); the check means "no code imports the deleted module", which holds.

### Follow-ups (out of scope, left untouched)
- `apps/mobile/src/lib/tools-api.ts:11` and `apps/web/src/lib/tools.ts:3` still name the deleted `apps/server/src/routines/routes.ts` as the routines wire contract; the contract now lives in `apps/server/src/routines/api.ts`.
- `apps/server/src/routines/api.ts:3` has the same stale reference ("the old Hono router (`routes.ts`, now a thin wrapper below)").

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet head is 8b225ae2, the current HEAD.
- **Lead check:**
  - the wrapper is deleted;
  - `service.test.ts` calls `createRoutinesApi(...).handler`;
  - no `expect` line changed.
- **Follow-ups:** stale comments at `apps/server/src/routines/api.ts:1-3`, `apps/mobile/src/lib/tools-api.ts:11` and `apps/web/src/lib/tools.ts:3`.
