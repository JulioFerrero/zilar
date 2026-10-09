---
id: T-0685
title: "A7: retire the setup Hono wrapper: move SetupRoutesDependencies to setup/api.ts as SetupApiDependencies, assert the route shape on SETUP_API_ROUTES, delete setup/routes.ts"
status: merged
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

**What changed (5 files, all in Allowed files)**
- `apps/server/src/setup/api.ts`: `SetupRoutesDependencies` moved here unchanged as `SetupApiDependencies` (same fields and comments). Added the type imports it needs (`Logger` from pino, `AuditRecorder`, `ServerConfig`, `ServerDatabase`, `CurrentMailer`, `RateLimiter`), merged into existing imports where present. Dropped the `./routes` import. Renamed its 3 uses. Removed the header comment sentence that pointed at `routes.ts`.
- `apps/server/src/app.ts`: `SetupApiDependencies` imported from `./setup/api` (merged into the existing import); the `Pick` in the `setup?` override now uses it. Prettier reflowed that `Pick` onto one line.
- `apps/server/src/setup/routes.test.ts`: Hono import removed; imports `SETUP_API_ROUTES`, `SETUP_RATE_LIMIT_MAX`, `SetupApiDependencies` from `./api`. The route-shape test now maps `SETUP_API_ROUTES` with the same three expectations (contains `GET|/api/setup/status`, contains `POST|/api/setup`, length 2). `failingSend`, `recordingSend` and `appFor` only had their type name changed.
- `apps/server/src/setup/routes.ts`: deleted (`git rm`).

**Deviation from the spec:** the spec said "every other test stays unchanged". The three helper signatures above had to change because of the type rename. No test body changed.

**Commands run**
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup src/app.test`: 4 files passed, 36 tests passed.
- `git grep -n "setup/routes'\|setup/routes\"\|from './routes'" -- apps/server/src/setup apps/server/src/app.ts`: no output.
- `pnpm gate`, first run: FAIL at format only. Prettier flagged `apps/server/src/app.ts` (the `Pick` reflow). Fixed with `pnpm exec prettier --write apps/server/src/app.ts`.
- `pnpm gate`, second run: GATE PASS.

**Gate summary lines**
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (13.4s)
PASS  lint  (1.2s)
PASS  typecheck  (3.3s)
PASS  tests @zilar/server  (7.0s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Stale references outside Allowed files (not edited):**
- `docs/audit/effect-last-mile.md:85, 116` still list `setup/routes.ts`.
- `docs/EFFECT_GUIDE.md:226` says "In `setup/routes.test.ts` the patch is still in place". The `db.transaction` patch is no longer in that file (grep finds nothing), so the sentence is out of date.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 2.8 min). The lead reviewed the diff directly.
- **Result:** `setup/routes.ts` is deleted, and the deps interface now lives in `api.ts` as `SetupApiDependencies`. The route-shape test asserts on `SETUP_API_ROUTES`. Renaming the type in the three test helpers follows from the spec. No file imports `setup/routes` any more, and the gate passed.
- **Docs:** the lead updates the mentions in `docs/audit/effect-last-mile.md` and `docs/EFFECT_GUIDE.md`.
