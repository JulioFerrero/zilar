---
id: T-0554
title: "Effect C (HTTP): routines routes (list per AI and per group, pause, resume, delete) onto the HttpApi adapter; createRoutinesRoutes stays as a thin Hono wrapper for the tests; tests unchanged"
status: todo
milestone: M5
branch: task/T-0554-effect-http-routines
model: auto
effort: low
depends_on: [T-0539]
estimate: 0.5 day
---

# T-0554: routines on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"** (items 8-10 too). The worked example is `apps/server/src/topics/api.ts`. **Do not touch** the routines service, scheduler or schedule files.

### Verified facts (do not re-derive; read each route for its exact step order, statuses and texts)
- **`apps/server/src/routines/routes.ts`** (324 lines):
  - `RoutinesRoutesDependencies` (line 37) holds `auth`, `db`, `audit?` and `now?: () => Date`;
  - `createRoutinesRoutes(deps): Hono` (45).
- **The five routes:**
  - `GET /ais/:id/routines` (53; 404 "AI not found");
  - `GET /groups/:id/routines` (76; 404 "Group not found");
  - `POST /routines/:id/pause` (101);
  - `POST /routines/:id/resume` (119);
  - `DELETE /routines/:id` (137), which answers **204** (line 148).
  
  An error mapper around line 313 turns service errors into 404 "Routine not found", 409 `needs_approval` or 400 with the service's `errorCode`. Keep it.
- **`apps/server/src/app.ts`** (around line 561) mounts `app.route('/api', createRoutinesRoutes({ auth, db, audit: auditRecorder }))`. Keep it at the same position.
- **The test mounts the Hono factory directly:** `apps/server/src/routines/service.test.ts:31` imports `createRoutinesRoutes` from `./routes`, and line 160 does `routes.route('/api', createRoutinesRoutes({ auth, db, audit }))`.
  
  **Keep `createRoutinesRoutes(deps): Hono` exported from `routes.ts` as a thin wrapper over the Effect handler.** T-0543 (push) did this: register each pair from an exported `ROUTINES_API_ROUTES` list on a `new Hono()` that forwards `context.req.raw` to `api.handler`, with the local path minus the `/api` prefix.

### What to build
1. **Create `apps/server/src/routines/api.ts`** with the five routes on `HttpApi`:
   - the same statuses (204 on delete), bodies, audit calls, texts and step order;
   - the same error mapping;
   - injectable `now`;
   - success schemas listing every field of the routine view (item 8). Dates must encode exactly as the old `c.json` did, as ISO strings.
   
   Export `ROUTINES_API_ROUTES`.
2. **`routes.ts`:** keep the dependency type and the `createRoutinesRoutes` wrapper. Remove the old handlers.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position.
4. **Tests:** every `apps/server/src/routines/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test` pass **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/topics/api.ts`, `apps/server/src/routines/routes.ts` (all of it), `apps/server/src/routines/service.test.ts` (lines 140-200), and the routines mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/routines/api.ts`, `apps/server/src/routines/routes.ts`, `apps/server/src/app.ts`, `work/T-0554-effect-http-routines.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot routines authz-sweep app.test
pnpm gate
```

### Acceptance
- Routines are served by Effect `HttpApi`, with the same answers and mount position.
- The tests are unchanged and green through the thin wrapper.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
