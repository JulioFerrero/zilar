---
id: T-0638
title: "Hono: retire the files item-11 wrapper (files/routes.ts); routes.test.ts calls createFilesApi(deps).handler directly, with the same injected fetchImpl/now/archive; delete the wrapper; same assertions"
status: merged
milestone: M5
branch: task/T-0638-retire-files-hono-wrapper
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0638: retire the files Hono wrapper

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A4 in the T-0626 last-mile audit. `apps/server/src/files/routes.ts` is a Hono wrapper (`docs/EFFECT_GUIDE.md` item 11) kept only so `routes.test.ts` can inject `fetchImpl` and `now`. T-0637 did the same for drafts.

### Verified facts (do not re-derive)
- **`apps/server/src/files/routes.ts`:**
  - imports `Hono`;
  - re-exports `FILES_API_ROUTES`, the `FILES_*` constants, `createFilesApi` and the type `FilesRoutesDependencies` from `./api`;
  - `createFilesRoutes(deps)` forwards local paths to `createFilesApi(deps).handler`.
- **The only importer** is `apps/server/src/files/routes.test.ts:17`. `git grep -n "files/routes" apps packages` shows no production use.
- **`createFilesApi(deps)`** (`apps/server/src/files/api.ts:173`) returns an `EffectApiMount` whose `handler` takes a `Request` with the full `/api/files?...` URL (`apps/server/src/effect/http.ts:155-158`).
- **The test:**
  - `filesApp(fetchImpl, withoutArchive)` (166-187) builds a Hono app with an `onError` that renders an `HttpError` and mounts the wrapper under `/api`;
  - `getFile(target, …)` (189-…) calls `target.request(`${TEST_BASE_URL}/api/files${params}`, init)`;
  - `filesApp` is called about 16 times.
  - `Hono` is imported at line 4 and `HttpError` at 18; the latter may become unused.

### What to build
1. **In `routes.test.ts`:**
   - make `filesApp` return `{ request(url, init) }`, calling `createFilesApi({ ...same deps }).handler(new Request(url, init))`;
   - widen `getFile`'s `target` type to that shape;
   - drop the Hono `onError` mount, because the Effect handler renders errors itself;
   - remove the imports that are now unused;
   - change nothing else. Every status, header, body and log assertion stays. **If an assertion fails only because the old `onError` rendered an error differently from the Effect handler, stop and report it in Blocked; do not change the assertion.**
2. **Delete** `apps/server/src/files/routes.ts`.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` item 11, `apps/server/src/files/routes.ts`, `apps/server/src/files/routes.test.ts` (lines 1-230), `apps/server/src/files/api.ts` (lines 160-200).

### Allowed files
`apps/server/src/files/routes.ts`, `apps/server/src/files/routes.test.ts`, `work/T-0638-retire-files-hono-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files
pnpm gate
```

### Acceptance
- `files/routes.ts` is gone, and the files tests pass against the Effect handler with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/files/routes.test.ts`:
  - `filesApp(fetchImpl, withoutArchive)` now builds `createFilesApi({ …same deps })` and returns `{ request(url, init) }` that calls `api.handler(new Request(url, init))`. Removed the Hono app and its `onError` mount.
  - Widened `getFile`'s `target` type to `{ request(url: string, init?: RequestInit): Promise<Response> }`.
  - Dropped the now-unused `Hono` and `HttpError` imports; import `createFilesApi` from `./api` instead of `createFilesRoutes` from `./routes`.
  - Changed nothing else: all status, header, body and `calls` assertions are unchanged.
- Deleted `apps/server/src/files/routes.ts`.

### Files changed
- `apps/server/src/files/routes.ts` (deleted)
- `apps/server/src/files/routes.test.ts` (imports, `filesApp`, `getFile` target type)
- `work/T-0638-retire-files-hono-wrapper.md` (status + this Report)

### Commands run and results
- `pnpm install`: Done (1173 packages).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files`: 1 test file passed, 14 tests passed, 0 failed.
- `pnpm gate`: GATE PASS.

### Gate summary lines
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (19.2s)
PASS  lint  (1.0s)
PASS  typecheck  (8.1s)
PASS  tests @zilar/server  (14.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Problems / deviations
- None. No assertion had to change; the Effect handler's error envelope produced the same status/code values the old `onError` did, so the `errorCode(json)` assertions passed unchanged.
- No other file imported the deleted module: `git grep -n "files/routes|createFilesRoutes" -- apps packages` returned no matches.

### Security checklist
- No secrets touched or logged. No new route, no delete/update scoping, no permission/cap changes; this is a test-only refactor plus deletion of a test wrapper.

### Open questions
- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet head is a039738a, the current HEAD.
- **Lead check:**
  - the wrapper is deleted;
  - `filesApp` now calls `createFilesApi(...).handler` with the same injected deps;
  - no `expect` line changed.
