---
id: T-0638
title: "Hono: retire the files item-11 wrapper (files/routes.ts); routes.test.ts calls createFilesApi(deps).handler directly, with the same injected fetchImpl/now/archive; delete the wrapper; same assertions"
status: todo
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

## Review (written by Claude)
