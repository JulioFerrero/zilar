---
id: T-0685
title: "A7: retire the setup Hono wrapper: move SetupRoutesDependencies to setup/api.ts as SetupApiDependencies, assert the route shape on SETUP_API_ROUTES, delete setup/routes.ts"
status: todo
milestone: M5
branch: task/T-0685-delete-setup-routes
model: auto
effort: low
depends_on: [T-0675]
estimate: 0.1 day
---

# T-0685: delete setup/routes.ts

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with Effect HTTP replacing Hono. `setup/routes.ts` is the last module wrapper on Hono (audit item A7 in `docs/audit/effect-last-mile.md`). It only serves the route-shape test. T-0675 removed the `db.transaction` patching that blocked it.

### Verified facts (do not re-derive)
- **`apps/server/src/setup/routes.ts`** (83 lines):
  - it exports `SetupRoutesDependencies` (lines 29-53), `createSetupRoutes` (a Hono wrapper that only the test uses) and `socketAddress`;
  - it re-exports `SETUP_RATE_LIMIT_MAX` and `SETUP_RATE_LIMIT_WINDOW_MS` from `./api` (line 27);
  - it imports Hono and `@hono/node-server/conninfo`.
- **Users of `SetupRoutesDependencies`:**
  - `apps/server/src/setup/api.ts:39` (a type import), with uses at `:57`, `:180` and `:385`;
  - `apps/server/src/app.ts:20` (import) and `:89` (a `Pick` in the `setup?` override);
  - `apps/server/src/setup/routes.test.ts:14`, `:40`, `:46` and `:60`.
- **`apps/server/src/setup/routes.test.ts`:**
  - line 14 imports `createSetupRoutes`, `SETUP_RATE_LIMIT_MAX` and the type from `./routes`;
  - line 7 imports `Hono`;
  - the test "registers exactly GET /api/setup/status and POST /api/setup" (about lines 349-364) builds the Hono wrapper. Its model is `apps/server/src/integrations/routes.test.ts:506-515`, which asserts on `INTEGRATIONS_API_ROUTES.map((route) => `${route.method}|${route.path}`)`.
- **The precedent:** T-0646 (`work/T-0646-delete-invite-links-routes.md`) moved the deps interface into `api.ts` and deleted the routes file.

### What to build
1. **Move `SetupRoutesDependencies` into `setup/api.ts`, unchanged, as `SetupApiDependencies`,** with the type imports it needs (skip any `api.ts` already has). Update its uses in `api.ts`, and drop the `./routes` import.
2. **`app.ts:20` and `:89`:** use `SetupApiDependencies` from `./setup/api`, merging into an existing `./setup/api` import if there is one.
3. **`setup/routes.test.ts`:**
   - import `SETUP_RATE_LIMIT_MAX` and `SetupApiDependencies` from `./api`;
   - rewrite only the route-shape test to assert on `SETUP_API_ROUTES`, the same three expectations as now (contains `GET|/api/setup/status`, contains `POST|/api/setup`, length 2);
   - drop the Hono import;
   - every other test stays unchanged.
4. **Delete `apps/server/src/setup/routes.ts`.** `git grep -n "setup/routes'" apps/server/src` must then show nothing.

### Read first
`AGENTS.md`, `apps/server/src/setup/routes.ts`, `apps/server/src/setup/api.ts` (lines 1-60), `apps/server/src/app.ts` (lines 1-100), `apps/server/src/integrations/routes.test.ts` (lines 500-515), `work/T-0646-delete-invite-links-routes.md`.

### Allowed files
`apps/server/src/setup/routes.ts`, `apps/server/src/setup/api.ts`, `apps/server/src/setup/routes.test.ts`, `apps/server/src/app.ts`, `work/T-0685-delete-setup-routes.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup src/app.test
pnpm gate
```

### Acceptance
- `setup/routes.ts` is gone, and no file imports it.
- The setup tests pass, with only the route-shape test rewritten.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
