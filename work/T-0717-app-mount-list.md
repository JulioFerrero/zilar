---
id: T-0717
title: "B1.3a: app.ts collects the 36 module mounts into one ordered `mounts: EffectApiMount[]` list and mounts them on Hono in one loop; createApp also exposes that list (no behaviour change; prepares the Effect edge)"
status: todo
milestone: M5
branch: task/T-0717-app-mount-list
model: auto
effort: low
depends_on: [T-0694]
estimate: 0.1 day
---

# T-0717: one ordered mount list in app.ts (B1.3a)

## Spec (written by Claude, do not edit)

### Why
Julio wants Effect HTTP to replace Hono. In `docs/audit/effect-edge-flip-plan.md` §4, B1.3 builds an Effect edge that dispatches to the module web handlers. This first slice gathers those handlers into one list that the edge can take, so that the large B1.3b task only swaps the router. **No behaviour change.**

### Verified facts (do not re-derive)
- **`apps/server/src/app.ts`** has 36 calls `mountEffectRoutes(app, xApi.routes, xApi.handler)` between lines 309 and 609, interleaved with the module builders (`const xApi = createXApi({...})`).
  - Before them sit the Hono middleware (lines 265-305) and `app.all('/api/auth/*', …)` (line 307).
  - After them come `/health` (line 611), `notFound` (line 626) and `onError` (line 633).
  - `createApp` starts at line 209 and returns `app` at line 665.
- **`EffectApiMount`** (`{ handler, routes }`) is exported from `apps/server/src/effect/http-core.ts:151`, and `mountEffectRoutes(app, routes, handler)` from `apps/server/src/effect/http.ts`.
- **Tests:** `apps/server/src/app.test.ts` and `apps/server/src/authz-sweep.test.ts` (it reads `app.routes` at line 79).

### What to build
1. **In `createApp`,** declare `const mounts: EffectApiMount[] = [];` before the first module.
   - Replace each `mountEffectRoutes(app, xApi.routes, xApi.handler);` with `mounts.push(xApi);`, in the same place and order. If an `xApi` is not assignable to `EffectApiMount`, push `{ routes: xApi.routes, handler: xApi.handler }`.
   - Right before `app.get('/health', …)`, mount them all with `for (const mount of mounts) { mountEffectRoutes(app, mount.routes, mount.handler); }`.
   - Every module builder call stays where it is, with the same arguments.
2. **Expose the list** for the next task: export `function effectMountsOf(app): ReadonlyArray<EffectApiMount>`, backed by a module-level `WeakMap` from the Hono app to its mounts, set just before `return app`. **Do not change the return type of `createApp`.**
3. **Add one test** in `app.test.ts`:
   - `effectMountsOf(testApp())` has 36 entries;
   - each route `{ method, path }` from those mounts appears in `app.routes`.

### Read first
`AGENTS.md`, `apps/server/src/app.ts` (lines 200-320 and 600-670), `apps/server/src/effect/http-core.ts` (lines 140-160), `apps/server/src/app.test.ts` (lines 1-60).

### Allowed files
`apps/server/src/app.ts`, `apps/server/src/app.test.ts`, `work/T-0717-app-mount-list.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/app.test src/authz-sweep.test
pnpm gate
```

### Acceptance
- `app.ts` has exactly one `mountEffectRoutes(` call, inside the loop.
- The authz sweep and `app.test.ts` pass, including the new test.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
