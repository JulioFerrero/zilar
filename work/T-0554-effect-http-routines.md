---
id: T-0554
title: "Effect C (HTTP): routines routes (list per AI and per group, pause, resume, delete) onto the HttpApi adapter; createRoutinesRoutes stays as a thin Hono wrapper for the tests; tests unchanged"
status: merged
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

Done. Routines are served by Effect `HttpApi`; tests unchanged and green.

What I did:
- Created `apps/server/src/routines/api.ts`: `HttpApi` group `routines` with the five
  endpoints (`GET /api/ais/:id/routines`, `GET /api/groups/:id/routines`,
  `POST /api/routines/:id/pause`, `POST /api/routines/:id/resume`,
  `DELETE /api/routines/:id`), same step order, same 404/409/400 texts, same
  `mapServiceError` mapping, injectable `now`, `Session` middleware, and
  `ROUTINES_API_ROUTES` export. Delete answers 204 via
  `HttpServerResponse.empty({ status: 204 })` with `success: Schema.Void`.
  All access helpers (`routineAccess`, `routineAccessIncludingDeleted`,
  `accessFor`, `deletedAccessFor`, `findOwnedAiRow`, `findMembership`) moved
  verbatim from the old `routes.ts`.
- Rewrote `apps/server/src/routines/routes.ts` as the thin wrapper: keeps
  `RoutinesRoutesDependencies` and exports `createRoutinesRoutes(deps): Hono`,
  which builds `createRoutinesApi` and registers `ROUTINES_API_ROUTES` with
  the `/api` prefix stripped (audit-api pattern).
- `apps/server/src/app.ts`: replaced `app.route('/api', createRoutinesRoutes(...))`
  with `mountEffectRoutes(app, routinesApi.routes, routinesApi.handler)` at the
  same position (between tools and xmpp mounts).

Schema side-by-side (item 8): list success schema lists all 15 `PublicRoutine`
fields (`id aiId groupId topicId toolId toolName title schedule status
pausedReason nextRunAt lastRunAt lastStatus approvedHosts scope`); pause/resume
schema lists the 11 `toWire` fields (`id title toolName schedule status
pausedReason nextRunAt lastRunAt lastStatus approvedHosts scope`). Handlers
answer raw objects with `Date`s converted via `.toISOString()` exactly as the
old `c.json` did (no `Schema.Date` decode/encode round-trip). `schedule` is
`Schema.Unknown` (no strict check existed in the old route).

Message texts: no decode-failure paths changed user-visible text — params are
plain strings, and the old routes had no body/query validation. Old vs new
texts identical: `AI not found`, `Group not found`, `Routine not found`,
409 `needs_approval` with service message, 400 with service `errorCode`.

Deviation / fix worth noting: service errors (`RoutineServiceError`) travel as
Effect defects through `Effect.promise`, which `try/catch` inside `Effect.gen`
cannot see — the first test run failed the 409 resume test with a 500. Fixed
with a `withServiceErrors` helper using `Effect.catchDefect` + `Effect.die`
(mapped `HttpError`), same as `audit/api.ts`'s `listPage`. Unknown rejections
pass through unchanged and stay 500, like the old route's unmapped throw.

Security checklist: 401 comes from `Session` before any logic; 404s for
unknown vs forbidden ids are identical; audit calls unchanged (ids only);
no new routes (exact 5 pairs, covered by the sweep); no secrets in errors.

Files changed: `apps/server/src/routines/api.ts` (new),
`apps/server/src/routines/routes.ts`, `apps/server/src/app.ts`. No test file
touched.

Commands (real results):
- `pnpm install`: ok (Done in 52.3s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/routines/service.test.ts`: first run 18 passed / 1 failed (409 resume
  case, 500 instead of 409); after the `catchDefect` fix: 19 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot authz-sweep
  app.test`: 2 files, 14 tests, all passed.
- `pnpm gate`: first run GATE FAIL on format only (my 2 files); after
  `prettier --write` on those two files, full gate: PASS install, PASS format,
  PASS lint, PASS typecheck, PASS tests @zilar/server (993.0s),
  `scope: every changed file is inside the Allowed files`, GATE PASS.

## Review (written by Claude)

Approved (lead, 2026-10-08). Routines (5 routes) are served by Effect HttpApi at the same mount position, with the same access helpers (line-identical), texts, 409/400 mapping, 204 on delete and injectable now. createRoutinesRoutes stays as the thin Hono wrapper (item 11). Lead check: RoutineListItem lists all 15 PublicRoutine fields and RoutineDetail matches the old toWire, with nullable enums kept. Pre-review clean.
