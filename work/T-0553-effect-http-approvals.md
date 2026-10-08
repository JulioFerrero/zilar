---
id: T-0553
title: "Effect C (HTTP): approvals and approval-rules routes (6) onto the HttpApi adapter, zod to Effect Schema; onDecided hook after the response kept; createApprovalsRoutes stays as a thin Hono wrapper for the tests; tests unchanged"
status: todo
milestone: M5
branch: task/T-0553-effect-http-approvals
model: auto
effort: low
depends_on: [T-0539]
estimate: 1 day
---

# T-0553: approvals on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"** (items 8-10 too). The worked examples are `apps/server/src/groups/api.ts` and `apps/server/src/topics/api.ts`. **Do not touch** `approvals/service.ts`, `approvals/rules.ts` or `approvals/sweeper.ts`.

### Verified facts (do not re-derive; read each route for its exact step order, statuses, bodies, audit calls and texts)
- **`apps/server/src/approvals/routes.ts`** (435 lines):
  - `ApprovalsRouteLogger` (line 31) and `ApprovalsRoutesDependencies` (35), which holds `auth`, `db`, `audit?`, `now?`, `logger?`, `onDecided?` and `alwaysEligible?`;
  - `createApprovalsRoutes(deps): Hono` (71).
- **The six routes:**
  - `GET /approvals` (83);
  - `GET /approvals/:id` (102);
  - `POST /approvals/:id/decision` (119). It decodes with `decisionSchema`, a strict `{ decision: 'approve_once' | 'approve_always' | 'deny', note?: string max 500 }`; a failure answers 400 `invalid_request` "Invalid decision body". **The `onDecided` hook fires after a successful decision, the response does not wait for it, and a throwing hook never changes the response.** Keep that exactly;
  - `GET /ais/:id/approval-rules` (231);
  - `GET /groups/:id/approval-rules` (261);
  - `DELETE /approval-rules/:id` (287), which answers **204** (`c.body(null, 204)`, line 332).
- **`apps/server/src/app.ts`** (around line 545) mounts `app.route('/api', createApprovalsRoutes({ auth, db, audit: auditRecorder, logger, onDecided: …, ...alwaysEligible }))`. Keep it at the same position.
- **The tests mount the Hono factory directly:**
  - `apps/server/src/approvals/routes.test.ts:33` imports `createApprovalsRoutes` from `./routes` and mounts it (lines 102, 596, 640, 697);
  - `apps/server/src/approvals/rules.routes.test.ts:28` does the same (line 120).
  
  **Keep `createApprovalsRoutes(deps): Hono` exported from `routes.ts` as a thin wrapper over the Effect handler.** T-0543 (push) did this: build the Effect API, then register each pair from an exported `APPROVALS_API_ROUTES` list on a `new Hono()` that forwards `context.req.raw` to `api.handler`. The local path drops the `/api` prefix, because the tests mount the wrapper under `/api`.

### What to build
1. **Create `apps/server/src/approvals/api.ts`** with the six routes on `HttpApi`:
   - the same statuses (204 on delete), bodies, audit calls, texts and step order;
   - the same `onDecided` timing and isolation;
   - `alwaysEligible` defaulting to "nothing is eligible";
   - injectable `now`;
   - success schemas listing every field (item 8).
   
   Export `APPROVALS_API_ROUTES`.
2. **`routes.ts`:** keep the dependency types and the `createApprovalsRoutes` wrapper. Remove the zod schemas and the old handlers.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position.
4. **Tests:** every `apps/server/src/approvals/*.test.ts`, the authz sweep (`authz-sweep`), `app.test` and the action-gateway tests (`apps/server/src/actions/*.test.ts`) pass **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/topics/api.ts`, `apps/server/src/approvals/routes.ts` (all of it), the two route tests, and the approvals mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/approvals/api.ts`, `apps/server/src/approvals/routes.ts`, `apps/server/src/app.ts`, `work/T-0553-effect-http-approvals.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot approvals actions authz-sweep app.test
pnpm gate
```

### Acceptance
- Approvals are served by Effect `HttpApi`, with the same answers, hook timing and mount position, and no zod.
- The tests are unchanged and green through the thin wrapper.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
