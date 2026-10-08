---
id: T-0645
title: "Hono: retire the push item-11 wrapper (createPushRoutes in push/api.ts plus the push/routes.ts re-export file); routes.test.ts calls createPushApi(...).handler; push/api.ts drops Hono; same assertions"
status: todo
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

## Review (written by Claude)
