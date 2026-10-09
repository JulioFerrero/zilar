---
id: T-0639
title: "Hono: retire the connections item-11 wrapper (connections/routes.ts); the rate-limit window test calls createConnectionsApi(deps).handler with an injected now; app.ts imports ConnectionsLogger from ./connections/api; delete the wrapper; same assertions"
status: merged
milestone: M5
branch: task/T-0639-retire-connections-hono-wrapper
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0639: retire the connections Hono wrapper

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A2 in the T-0626 last-mile audit. T-0637 (drafts) and T-0638 (files) do the same for other modules.

### Verified facts (do not re-derive)
- **`apps/server/src/connections/routes.ts`:**
  - re-exports the constants, `createConnectionsApi` and three types from `./api`;
  - imports `Hono`;
  - defines `createConnectionsRoutes(deps)`, which forwards local paths to `createConnectionsApi(deps).handler`.
- **Its importers:**
  - `apps/server/src/app.ts:33`: `import { type ConnectionsLogger } from './connections/routes';`. The type is defined in `./connections/api`;
  - `apps/server/src/connections/routes.test.ts:17-21`: `CONNECTION_TEST_RATE_LIMIT_MAX`, `CONNECTION_TEST_RATE_LIMIT_WINDOW_MS`, `createConnectionsRoutes`.
- **The only wrapper mount** is in the rate-limit window test (around 451-468): a Hono app with an `onError` that renders `HttpError`, mounting the wrapper under `/api` with `now: () => now`. `testKey()` calls `limited.request(`/api/connections/${id}/test`, …)` with a **relative** URL. `TEST_BASE_URL` is already imported (line 10).
- **Other tests in the file** use `createApp` (for example line 89), so they are unaffected.

### What to build
1. **`app.ts:33`:** import `ConnectionsLogger` from `./connections/api`, type-only. Change nothing else in `app.ts`.
2. **In `routes.test.ts`:**
   - import the two constants and `createConnectionsApi` from `./api`;
   - in the window test, build `const api = createConnectionsApi({ ...same deps })` and make `testKey()` call `api.handler(new Request(`${TEST_BASE_URL}/api/connections/${id}/test`, { …same init }))`;
   - drop the Hono app and its `onError`;
   - remove the imports that are now unused (`Hono`, perhaps `HttpError`);
   - every assertion stays: 200 × max, then 429, then 200 after the window. If one fails only because of error rendering, stop and report it in Blocked.
3. **Delete** `apps/server/src/connections/routes.ts`. Then `git grep -n "connections/routes" apps` must show nothing.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` item 11, `apps/server/src/connections/routes.ts`, `apps/server/src/connections/routes.test.ts` (lines 1-30 and 430-490).

### Allowed files
`apps/server/src/connections/routes.ts`, `apps/server/src/connections/routes.test.ts`, `apps/server/src/app.ts`, `work/T-0639-retire-connections-hono-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/connections src/app
pnpm gate
```

### Acceptance
- `connections/routes.ts` is gone, `app.ts` imports the type from `./connections/api`, and the connections tests pass with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/app.ts:33`: import the `ConnectionsLogger` type (type-only) from
  `./connections/api` instead of the deleted wrapper. Nothing else in `app.ts` changed.
- `apps/server/src/connections/routes.test.ts`: import
  `CONNECTION_TEST_RATE_LIMIT_MAX`, `CONNECTION_TEST_RATE_LIMIT_WINDOW_MS` and
  `createConnectionsApi` from `./api`; removed the now-unused `Hono` and `HttpError`
  imports. In the "allows key tests again after the window" test, replaced the Hono app
  + `onError` + `createConnectionsRoutes` mount with
  `const api = createConnectionsApi({ ...same deps, now: () => now })`, and `testKey()`
  now calls `api.handler(new Request(`${TEST_BASE_URL}/api/connections/${id}/test`, { ...same init }))`
  with the full `/api` path. Every assertion stayed the same: `MAX` × 200, then 429, then
  200 after the window.
- Deleted `apps/server/src/connections/routes.ts` (the item-11 Hono wrapper).

### Files changed
- `apps/server/src/app.ts` (edited)
- `apps/server/src/connections/routes.test.ts` (edited)
- `apps/server/src/connections/routes.ts` (deleted)
- `work/T-0639-retire-connections-hono-wrapper.md` (this report + status)

### Commands run (real results)
- `pnpm install` → Done in 12.9s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/connections src/app`
  → Test Files 11 passed | 1 skipped (12); Tests 167 passed | 1 skipped (168);
  Duration 47.87s.
- `pnpm gate` → summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (19.8s)
  PASS  lint  (0.8s)
  PASS  typecheck  (9.8s)
  PASS  tests @zilar/server  (8.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- Spec "What to build" step 3 asks `git grep -n "connections/routes" apps` to show
  nothing. It still matches one **stale doc comment** at
  `apps/mobile/src/lib/connections-api.ts:10` ("The wire contract lives in
  `apps/server/src/connections/routes.ts`"). That file is outside the Allowed files, so I
  left it untouched, exactly as `AGENTS.md` requires. No code imports the deleted module;
  the only remaining match is a documentation reference. Recommend a follow-up nits task
  to repoint it at `apps/server/src/connections/api.ts` (same pattern as the deferred
  drafts stale-comment follow-up noted in T-0637's review).
- No assertion changed, and none failed.

### Blocked / needs a decision
- Not blocking. The single open point is the stale mobile doc comment above: a scope
  question that can be handled in a follow-up rather than by editing a file outside the
  Allowed files.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet head is d83da582, the current HEAD.
- **Lead check:**
  - the wrapper is deleted;
  - `app.ts:33` imports the type from `./connections/api`;
  - no `expect` line changed.
- **Follow-up:** the stale comment at `apps/mobile/src/lib/connections-api.ts:10`.
