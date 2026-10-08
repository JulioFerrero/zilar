---
id: T-0637
title: "Hono: retire the drafts item-11 wrapper (drafts/routes.ts); routes.test.ts calls createDraftsApi({ auth, hub }).handler with full /api URLs instead; delete the wrapper; same assertions"
status: merged
milestone: M5
branch: task/T-0637-retire-drafts-hono-wrapper
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0637: retire the drafts Hono wrapper

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A3 in the T-0626 last-mile audit. `apps/server/src/drafts/routes.ts` is a Hono wrapper (`docs/EFFECT_GUIDE.md` item 11) kept only so `routes.test.ts` can mount the route with an injected `hub`.

### Verified facts (do not re-derive)
- **`apps/server/src/drafts/routes.ts`** (37 lines):
  - imports `Hono`;
  - re-exports `DRAFT_SSE_HEARTBEAT_MS` from `./api`;
  - its `createDraftsRoutes({ auth, hub })` builds `createDraftsApi({ auth, hub })` and forwards local `/drafts/...` paths to `api.handler` with the `/api` prefix put back.
- **Nothing in production imports it.** The only importer is `apps/server/src/drafts/routes.test.ts:12` (`createDraftsRoutes`, `DRAFT_SSE_HEARTBEAT_MS`).
- **`createDraftsApi(deps)`** (`apps/server/src/drafts/api.ts:76`) returns an `EffectApiMount`, whose `handler` is a fetch handler `(request: Request) => Promise<Response>` (`apps/server/src/effect/http.ts:155-158`). It matches the full `/api/drafts/stream` path.
- **The test** builds the wrapper in `routesForCookie()` (106-108) and calls `routes.request('/drafts/stream', init)` 7 times (for example 119, 166, 193).

### What to build
1. **In `routes.test.ts`:**
   - import `createDraftsApi` and `DRAFT_SSE_HEARTBEAT_MS` from `./api`;
   - make `routesForCookie()` return a small `{ request(path, init) }` object, or change the call sites, so each call becomes `api.handler(new Request(`${TEST_BASE_URL}/api${path}`, init))` with the same path and init.

   Change nothing else: every assertion, timer and hub check stays the same.
2. **Delete** `apps/server/src/drafts/routes.ts`.
3. Run `git grep -n "drafts/routes" apps` and confirm nothing else imports it.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` item 11, `apps/server/src/drafts/routes.ts`, `apps/server/src/drafts/routes.test.ts`, `apps/server/src/drafts/api.ts` (lines 60-100).

### Allowed files
`apps/server/src/drafts/routes.ts`, `apps/server/src/drafts/routes.test.ts`, `work/T-0637-retire-drafts-hono-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/drafts
pnpm gate
```

### Acceptance
- `drafts/routes.ts` is gone, and the drafts tests pass against the Effect handler with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/drafts/routes.test.ts`: replaced the `./routes` import with
  `createDraftsApi, DRAFT_SSE_HEARTBEAT_MS` from `./api`. `routesForCookie()` now
  builds the Effect mount once and returns `{ request(path, init) }`, which calls
  `api.handler(new Request(`${TEST_BASE_URL}/api${path}`, init))` — the full
  `/api`-prefixed path the Effect router matches. All 7 call sites, assertions,
  timers and hub checks are unchanged.
- Deleted `apps/server/src/drafts/routes.ts` (the item-11 Hono wrapper).
- `git grep -n "drafts/routes" apps` → no output (nothing else imported it).

### Files changed
- `apps/server/src/drafts/routes.test.ts` (edited)
- `apps/server/src/drafts/routes.ts` (deleted)
- `work/T-0637-retire-drafts-hono-wrapper.md` (this report + status)

### Commands run (real results)
- `pnpm install` → Done in 14.7s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/drafts`
  → Test Files 2 passed (2); Tests 14 passed (14); Duration 6.45s.
- `pnpm gate` → summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (21.0s)
  PASS  lint  (1.1s)
  PASS  typecheck  (17.6s)
  PASS  tests @zilar/server  (7.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
None. The spec's alternative "change the call sites" was not needed: keeping
`routes.request(path, init)` left all call sites untouched.

### Blocked / needs a decision
None.


## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 follow-up. The packet head is 4445cc9a, the current HEAD.
- **Lead check:**
  - the wrapper is deleted;
  - the test calls `createDraftsApi({ auth, hub }).handler` with full `/api` URLs;
  - no assertion changed.
- **Follow-up, for the next nits task:** the stale comment at `drafts/api.ts:146-148` still refers to the wrapper.
