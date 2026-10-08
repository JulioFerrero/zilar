---
id: T-0641
title: "Hono: retire the approvals item-11 wrapper (approvals/routes.ts); the five test mounts in routes.test.ts and rules.routes.test.ts call createApprovalsApi(...).handler through one small test helper; delete the wrapper; same assertions"
status: merged
milestone: M5
branch: task/T-0641-retire-approvals-hono-wrapper
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0641: retire the approvals Hono wrapper

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A1 in the T-0626 last-mile audit. T-0637 to T-0640 do the same for drafts, files, connections and routines.

### Verified facts (do not re-derive)
- **`apps/server/src/approvals/routes.ts`** (53 lines) imports `Hono`. Its `createApprovalsRoutes({ logger, ...deps })` builds `createApprovalsApi({ ...deps, logger: logger ?? pino({ level: 'silent' }) })` and mounts it with `/api` stripped. `ApprovalsRouteLogger` is also defined in `./api` (`apps/server/src/approvals/api.ts:65`).
- **The only importers:**
  - `apps/server/src/approvals/routes.test.ts:33`: mounts at about 102, 596, 640 and 697;
  - `apps/server/src/approvals/rules.routes.test.ts:28`: mounts at about 120.
- **Each mount** builds `new Hono()`, adds an `onError` that renders `HttpError`, and does `routes.route('/api', createApprovalsRoutes({ auth, db, audit, now, … }))`. Some mounts may also pass `logger`; read each one.
- **Requests** use full URLs, for example `app.request(`${TEST_BASE_URL}/api/approvals`, …)`. `buildApprovalsHarness` returns the app as `HonoRequester`.
- **`createApprovalsApi(deps)`** returns an `EffectApiMount` whose `handler` takes a `Request` with the full `/api/...` URL.

### What to build
1. **In each test file**, add one small local helper:

   ```ts
   function approvalsRequester(deps) {
     const api = createApprovalsApi({ ...deps, logger: deps.logger ?? pino({ level: 'silent' }) });
     return { request: (url, init) => api.handler(new Request(url, init)) };
   }
   ```

   Type it from `ApprovalsApiDependencies`.
2. **Replace the five Hono mounts** with that helper, passing the same deps, including any `logger` captor. Keep the `HonoRequester` shape where the harness returns it, or narrow its type to `{ request(url, init): Promise<Response> }`.
3. **Remove the imports** that are now unused (`Hono`, perhaps `HttpError`).
4. **Every assertion stays.** If one fails only because of error rendering, stop and report it in Blocked.
5. **Delete** `apps/server/src/approvals/routes.ts`. Then `git grep -n "approvals/routes'" apps` must show nothing.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` item 11, `apps/server/src/approvals/routes.ts`, the mounts in both test files, `apps/server/src/approvals/api.ts` (lines 55-80 and 215-235).

### Allowed files
`apps/server/src/approvals/routes.ts`, `apps/server/src/approvals/routes.test.ts`, `apps/server/src/approvals/rules.routes.test.ts`, `work/T-0641-retire-approvals-hono-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/routes src/approvals/rules.routes
pnpm gate
```

### Acceptance
- `approvals/routes.ts` is gone, and both test files pass with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** review. **Branch:** `task/T-0641-retire-approvals-hono-wrapper`.

### What I did
- Deleted `apps/server/src/approvals/routes.ts` (the item-11 Hono wrapper:
  `createApprovalsRoutes`, `ApprovalsRoutesDependencies`, `ApprovalsRouteLogger`).
- Added one local test helper to each test file:

  ```ts
  function approvalsRequester(deps: ApprovalsRequesterDependencies): HonoRequester {
    const api = createApprovalsApi({
      ...deps,
      logger: (deps.logger ?? pino({ level: 'silent' })) as ApprovalsApiDependencies['logger'],
    });
    return {
      request: (input: string, init?: RequestInit) => api.handler(new Request(input, init)),
    };
  }
  ```

  `ApprovalsRequesterDependencies` is `Omit<ApprovalsApiDependencies, 'logger'> & { logger?: ApprovalsRouteLogger }`,
  matching the deleted wrapper's deps shape, so the hook-failure test can keep
  passing its `{ error }` captor. Both imports come from `./api` (where
  `ApprovalsRouteLogger` already lives).
- Replaced all five Hono mounts with the helper, passing the same deps
  (`auth`, `db`, `audit`, `now`, plus `onDecided`, `alwaysEligible` and the
  `logger` captor where present). Removed the now-unused `Hono` and `HttpError`
  imports and the per-mount `onError` renderers.
- `routes.test.ts` keeps the existing `HonoRequester` interface and returns it
  from the helper/harness; `rules.routes.test.ts` adds a local
  `ApprovalsRequester` interface and uses it for `app` and `decideRequest`.
- Every assertion is unchanged.

### Why the error envelope still matches
The mounts previously wrapped the Effect handler in `mountEffectRoutes` and
rendered `HttpError` in a Hono `onError`. In fact the Effect handler already
renders its own envelope (`withErrorEnvelope` / `failureResponse` in
`effect/http.ts`), so the Hono `onError` was never hit for these routes.
Calling `api.handler` directly produces the same `{ error: { code, message, ... } }`
body, which is why the 400/403/404/409 assertions pass unchanged. The only
difference: the test helper does not pass through `forwardRequest`, so the
error body's `requestId` is `''` instead of Hono's generated value. No test
asserts `requestId`, and the tests that compare two error bodies compare them
within the same helper, so they stay equal.

### Files changed (all inside Allowed files)
- `apps/server/src/approvals/routes.ts` — deleted.
- `apps/server/src/approvals/routes.test.ts` — helper + five mounts removed.
- `apps/server/src/approvals/rules.routes.test.ts` — helper + mount removed.
- `work/T-0641-retire-approvals-hono-wrapper.md` — status/report.

### Commands run (real results)
- `git grep -n "approvals/routes'" apps` → no matches (exit 1). Spec's proof.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/routes src/approvals/rules.routes`
  → `Test Files 2 passed (2)`, `Tests 43 passed (43)`.
- `pnpm gate` (repo root) summary lines:

  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.3s)
  PASS  format  (18.9s)
  PASS  lint  (1.2s)
  PASS  typecheck  (11.5s)
  PASS  tests @zilar/server  (18.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec
- None. The helper was typed from `ApprovalsApiDependencies` as asked; the
  `HonoRequester` shape is kept in `routes.test.ts` and narrowed to a local
  `ApprovalsRequester` in `rules.routes.test.ts`.

### Security checklist
- No new route, no auth boundary change, no secret or log-path change; this
  is a test-only refactor plus the deletion of a compatibility wrapper already
  unused by production (`app.ts` uses `createApprovalsApi`). All 401/404/403
   assertions still run.

### Open questions / blocked
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is 97ec6dd9, the current HEAD.
- **Lead check:**
  - the wrapper is deleted;
  - the five Hono mounts now call `createApprovalsApi(...).handler`;
  - the other changed lines are the harness and formatting;
  - no `expect` line changed.
