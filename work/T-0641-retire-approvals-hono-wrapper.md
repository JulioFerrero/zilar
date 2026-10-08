---
id: T-0641
title: "Hono: retire the approvals item-11 wrapper (approvals/routes.ts); the five test mounts in routes.test.ts and rules.routes.test.ts call createApprovalsApi(...).handler through one small test helper; delete the wrapper; same assertions"
status: todo
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

## Review (written by Claude)
