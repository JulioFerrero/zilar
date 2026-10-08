---
id: T-0640
title: "Hono: retire the routines item-11 wrapper (routines/routes.ts); service.test.ts's buildRoutesHarness calls createRoutinesApi(...).handler with a silent logger and the same audit; delete the wrapper; same assertions"
status: todo
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

## Review (written by Claude)
