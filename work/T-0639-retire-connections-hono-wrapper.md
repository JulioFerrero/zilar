---
id: T-0639
title: "Hono: retire the connections item-11 wrapper (connections/routes.ts); the rate-limit window test calls createConnectionsApi(deps).handler with an injected now; app.ts imports ConnectionsLogger from ./connections/api; delete the wrapper; same assertions"
status: todo
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

## Review (written by Claude)
