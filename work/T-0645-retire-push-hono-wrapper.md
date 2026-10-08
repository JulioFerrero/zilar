---
id: T-0645
title: "Hono: retire the push item-11 wrapper (createPushRoutes in push/api.ts plus the push/routes.ts re-export file); routes.test.ts calls createPushApi(...).handler; push/api.ts drops Hono; same assertions"
status: merged
milestone: M5
branch: task/T-0645-retire-push-hono-wrapper
model: auto
effort: low
depends_on: []
estimate: 0.25 day
---

# T-0645: retire the push Hono wrapper

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0. This is A9 in the T-0626 last-mile audit. After this task, `push/api.ts` no longer imports Hono.

### Verified facts (do not re-derive)
- **`apps/server/src/push/api.ts`:**
  - imports `Hono` (line 30);
  - `createPushRoutes(deps)` (lines 630-645) mounts each `PUSH_API_ROUTES` path with `/api` stripped and calls `api.handler(context.req.raw)`;
  - `PushRoutesDependencies` (lines 71-83) is the base of `PushApiDependencies` (line 85) and **stays**;
  - the header comment at lines 2-3 names the old Hono router.
- **`apps/server/src/push/routes.ts`** only re-exports from `./api`: the six `PUSH_*` constants, `createPushApi`, `createPushRoutes`, both deps types and `PUSH_API_ROUTES`.
- **The only users** (`git grep`):
  - `apps/server/src/push/routes.test.ts:14`: `import { createPushRoutes } from './routes';`. There are three mounts, at about lines 237, 306 and 367. Each builds `createPushRoutes({ ...deps, sender })`, then a `new Hono()` with `app.route('/api', routes)` and an `onError` that renders `HttpError`, and calls `app.request(...)` with full URLs.
  - `apps/server/src/app.ts:47` imports only `createPushApi` from `./push/api`. **Do not touch `app.ts`.**
- **`createPushApi(deps)`** returns an `EffectApiMount` whose `handler` takes a `Request` with the full `/api/...` URL.

### What to build
1. **In `routes.test.ts`:**
   - in each of the three tests, build `const api = createPushApi({ same deps })` and replace `app.request(url, init)` with `api.handler(new Request(url, init))` (a small local helper is fine);
   - drop the Hono app and its `onError`;
   - import `createPushApi` from `./api`;
   - remove the imports that are now unused (`Hono`, perhaps `HttpError`).
   - **Every assertion stays.** If one fails only because of error rendering, stop and report it in Blocked.
2. **In `push/api.ts`:**
   - delete `createPushRoutes` and its doc comment;
   - remove the `Hono` import;
   - make the header comment say the Hono router is gone.
3. **Delete** `apps/server/src/push/routes.ts`. Then `git grep -n "createPushRoutes\|push/routes'" apps` and `git grep -n "from './routes'" apps/server/src/push` must show nothing in code. List doc comments outside the Allowed files under Follow-ups.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` item 11, `apps/server/src/push/routes.ts`, `apps/server/src/push/api.ts` (lines 1-90 and 615-645), `apps/server/src/push/routes.test.ts` (lines 1-20 and 225-400).

### Allowed files
`apps/server/src/push/api.ts`, `apps/server/src/push/routes.ts`, `apps/server/src/push/routes.test.ts`, `work/T-0645-retire-push-hono-wrapper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/routes
pnpm gate
```

### Acceptance
- `push/routes.ts` is gone, `push/api.ts` has no `hono` import, and the push route tests pass with the same assertions.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- **`apps/server/src/push/routes.test.ts`:** dropped the `Hono` and `HttpError`
  imports and the `./routes` import; imported `createPushApi` from `./api`
  instead. Added a small local `requestPush(api, url, init)` helper that returns
  `api.handler(new Request(url, init))`. In the three tests that mounted the old
  Hono wrapper (`sends a test notification…`, `deletes the row before answering
  410…`, `stamps failed_at…`), replaced `createPushRoutes({ … })`, `new Hono()`,
  `app.route('/api', routes)` and the `onError` renderer with
  `const api = createPushApi({ … })`, and every `app.request(url, init)` with
  `requestPush(api, url, init)`. Every assertion is unchanged. The three tests
  still call `createApp` only to bootstrap users/sessions.
- **`apps/server/src/push/api.ts`:** deleted `createPushRoutes` and its doc
  comment, removed the `import { Hono } from 'hono'` line, and updated the header
  comment to say the Hono router is retired. `PushRoutesDependencies` stays as the
  base of `PushApiDependencies`.
- **`apps/server/src/push/routes.ts`:** deleted with `git rm`.

### Verification
- `git grep -n "createPushRoutes\|push/routes'" apps` → no matches.
- `git grep -n "from './routes'" apps/server/src/push` → no matches (`./routes`
  hits elsewhere are other modules' own route files).
- `push/api.ts` has no `hono` import; `routes.test.ts` has no `Hono`/`HttpError`
  import.

### Commands and real results
- `pnpm install` → done, no errors (peer-dep warning in `apps/mobile` is pre-existing).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/routes`
  → `Test Files 1 passed (1)`, `Tests 9 passed (9)`.
- `pnpm gate` (from repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (19.6s)
  PASS  lint  (1.7s)
  PASS  typecheck  (11.2s)
  PASS  tests @zilar/server  (21.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None. No assertion changed; no test failed because of error rendering.
- No extra tests added: this task only removes a wrapper and rewires existing
  coverage, so the touched package's existing push tests are the coverage.

### Follow-ups (outside the Allowed files)
- `apps/web/src/lib/api.ts:1751` (doc comment): "The wire contract lives in
  `apps/server/src/push/routes.ts`." That file is now deleted; the comment should
  point at `apps/server/src/push/api.ts`.
- `docs/audit/effect-last-mile.md` rows 80, 119 and 353 still describe
  `createPushRoutes` / `push/routes.ts` (A9); the audit doc can now read "done".

### Security checklist
- No behavior, auth, rate-limit or logging change: the same Effect handlers serve
  the same routes. The tests still assert the 404/410/502 envelopes and that no
  endpoint/keys/log text leak.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is f3ad4e3e, the current HEAD.
- **Lead check:**
  - `push/api.ts` has no hono import;
  - the wrapper and the re-export file are deleted;
  - no `expect` line changed.
- **Nit:** the comment at `api.ts:191` stays, because `app.ts` still mounts the handler through the Hono bridge.
- **Follow-up:** the stale comment at `apps/web/src/lib/api.ts:1751`.
