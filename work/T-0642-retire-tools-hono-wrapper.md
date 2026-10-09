---
id: T-0642
title: "Hono: retire the tools item-11 wrapper (tools/routes.ts); routes.test.ts calls createToolsApi(...).handler directly; app.ts types its deps from ToolsApiDependencies; delete the wrapper; same assertions"
status: merged
milestone: M5
branch: task/T-0642-retire-tools-hono-wrapper
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0642: retire the tools Hono wrapper

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A8 in the T-0626 last-mile audit. T-0637 to T-0641 do the same for drafts, files, connections, routines and approvals.

### Verified facts (do not re-derive)
- **`apps/server/src/tools/routes.ts`** (70 lines):
  - imports `Hono`;
  - re-exports `MAX_TOOL_RUN_INPUT_BYTES`, `TOOL_RUN_RATE_LIMIT_MAX` and `TOOL_RUN_RATE_LIMIT_WINDOW_MS` from `./api`;
  - defines `ToolsRoutesDependencies` (`auth`, `db`, `audit?`, `toolRunner?`, `now?`);
  - `createToolsRoutes` builds `createToolsApi({ auth, db, logger: silent pino, audit?, toolRunner?, now })` and mounts it with `/api` stripped.
- **The only importers** (`git grep`):
  - `apps/server/src/app.ts:61`: `import type { ToolsRoutesDependencies } from './tools/routes';`, used at `app.ts:541` as the type of `toolsDeps`, which is then passed as `createToolsApi({ ...toolsDeps, logger })` at 547;
  - `apps/server/src/tools/routes.test.ts:26`: `import { createToolsRoutes, TOOL_RUN_RATE_LIMIT_MAX } from './routes';`.
- **`ToolsApiDependencies`** (`apps/server/src/tools/api.ts:263-274`) has `auth`, `db`, `logger`, `audit?`, `toolRunner?`, `now?` and `runLimiter?`. `createToolsApi` (`api.ts:289`) returns an `EffectApiMount` whose `handler` takes a `Request` with the full `/api/...` URL.
- **The test:**
  - `buildRoutesHarness(context, options)` (about lines 103-127) builds `new Hono()`, adds an `onError` that renders `HttpError`, and mounts `createToolsRoutes({ auth, db, audit, toolRunner?, now? })` under `/api`;
  - `buildRoutesHarness` is called 3 times; requests use full `${TEST_BASE_URL}/api/...` URLs;
  - `Hono` is imported at line 4 and `HttpError` at line 17.

### What to build
1. **In `apps/server/src/app.ts`:**
   - type `toolsDeps` as `Omit<ToolsApiDependencies, 'logger'>`, importing the type from `./tools/api` (merge it into the existing `createToolsApi` import at line 60);
   - drop line 61.
   - Nothing else changes.
2. **In `routes.test.ts`:**
   - make `buildRoutesHarness` return `{ request(url, init) }`, calling `createToolsApi({ same deps, logger: pino({ level: 'silent' }) }).handler(new Request(url, init))`;
   - drop the Hono `onError` mount;
   - import `TOOL_RUN_RATE_LIMIT_MAX` and `createToolsApi` from `./api`;
   - remove the imports that are now unused.
   - **Every assertion stays.** If one fails only because of error rendering, stop and report it in Blocked.
3. **Delete** `apps/server/src/tools/routes.ts`. Then `git grep -n "tools/routes'" apps` must show nothing.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` item 11, `apps/server/src/tools/routes.ts`, `apps/server/src/tools/routes.test.ts` (lines 1-130), `apps/server/src/tools/api.ts` (lines 255-300), `apps/server/src/app.ts` (lines 55-65 and 536-550).

### Allowed files
`apps/server/src/tools/routes.ts`, `apps/server/src/tools/routes.test.ts`, `apps/server/src/app.ts`, `work/T-0642-retire-tools-hono-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/routes
pnpm gate
```

### Acceptance
- `tools/routes.ts` is gone, and the tools route tests pass with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- **`apps/server/src/app.ts`**: merged `ToolsApiDependencies` into the existing `createToolsApi` import from `./tools/api` (line 60), dropped the `ToolsRoutesDependencies` import, and changed `toolsDeps` to `Omit<ToolsApiDependencies, 'logger'>`. Nothing else changed.
- **`apps/server/src/tools/routes.test.ts`**: `buildRoutesHarness` no longer builds a Hono app; it now builds `createToolsApi({ auth, db, logger: pino({ level: 'silent' }), audit, ...toolRunner, ...now })` and returns `{ request(url, init) }` calling `api.handler(new Request(url, init))`. Removed the Hono `onError` mount, the `Hono`/`HttpError` imports, and the `createToolsRoutes` import; added `pino`, `createToolsApi` and `TOOL_RUN_RATE_LIMIT_MAX` imports. `let app` is now typed `ReturnType<typeof buildRoutesHarness>`. Every assertion is unchanged.
- **`apps/server/src/tools/routes.ts`**: deleted. `git grep -n "tools/routes'" apps` returns nothing.

### Files changed
- `apps/server/src/app.ts`
- `apps/server/src/tools/routes.test.ts`
- `apps/server/src/tools/routes.ts` (deleted)
- `work/T-0642-retire-tools-hono-wrapper.md`

### Commands and real results
- `pnpm install`: Done (peer-dependency warnings only, as before).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/routes`: 1 test file passed, 19 tests passed.
- `pnpm gate`: summary lines:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (35.7s)
  PASS  lint  (1.5s)
  PASS  typecheck  (21.9s)
  PASS  tests @zilar/server  (11.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
None. All assertions stayed and pass; no error-rendering mismatch appeared.

### Open questions
None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet head is 014d8114, the current HEAD.
- **Lead check:**
  - `app.ts` changes only the deps type;
  - the wrapper is deleted;
  - no `expect` line changed.
