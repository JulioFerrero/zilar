---
id: T-0553
title: "Effect C (HTTP): approvals and approval-rules routes (6) onto the HttpApi adapter, zod to Effect Schema; onDecided hook after the response kept; createApprovalsRoutes stays as a thin Hono wrapper for the tests; tests unchanged"
status: merged
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

Done. Approvals (6 routes) now run on the Effect `HttpApi` adapter; tests unchanged and green.

What I did:
- Created `apps/server/src/approvals/api.ts`: `HttpApi` group `approvals` with the six
  endpoints (`GET /approvals`, `GET /approvals/:id`, `POST /approvals/:id/decision`,
  `GET /ais/:id/approval-rules`, `GET /groups/:id/approval-rules`,
  `DELETE /approval-rules/:id`), all under the `/api` prefix with `Session` middleware.
  Same statuses (204 on delete via `HttpApiSchema.NoContent`), bodies, audit calls
  (`approval.decided`, `approval_rule.created`, `approval_rule.revoked`), step order,
  and texts as the old Hono router. `onDecided` fires fire-and-forget after a successful
  decision (`void Promise.resolve().then(...)` with the same log-on-throw, response never
  waits). `alwaysEligible` defaults to "nothing eligible"; `now` injectable.
  Exported `APPROVALS_API_ROUTES` with the exact six method+path pairs.
- Replaced `apps/server/src/approvals/routes.ts` with a thin wrapper: keeps
  `ApprovalsRouteLogger`, `ApprovalsRoutesDependencies` (same shape, `logger` stays
  optional) and `createApprovalsRoutes(deps): Hono`, which builds the Effect API and
  registers the routes with the `/api` prefix stripped (tests mount under `/api`).
  zod schemas and old handlers removed. `routes.ts` re-exports nothing from service/rules;
  `service.ts`, `rules.ts`, `sweeper.ts` untouched.
- `apps/server/src/app.ts`: same position, now
  `mountEffectRoutes(app, approvalsApi.routes, approvalsApi.handler)` with the same deps
  (`onDecided: (approvalId) => gateway.onApprovalDecided(approvalId)`, `alwaysEligible`
  passthrough).

Schema notes (item 8): `PublicApprovalView` lists all 18 fields of `PublicApproval`
(id, aiId, groupId, topicId, topicName, action, summary, details, argsHash, worstCase
{currency, amount}, requestedBy, status incl. `expired`, decidedAt, note, expiresAt,
createdAt, alwaysEligible, approverNames); `PublicApprovalRuleView` lists all 8 fields
of `PublicApprovalRule` (id, action, scope, groupId, topicId, topicName, createdAt,
createdBy). Side-by-side compare done against `service.ts:87-119` and `rules.ts:22-35`.

Texts (item 10): old zod path answered the first zod issue message on a bad decision
body; new path answers the fixed text "Invalid decision body" with the same status 400
and code `invalid_request`. No test asserts the exact text (only status), so this is
the allowed generic-decode-message change. All other texts byte-identical
(`Approval not found`, `AI not found`, `Group not found`, `Approval rule not found`,
`Invalid JSON body` no longer reachable — an empty/unparseable body now fails the
payload decode with `Invalid decision body`, same 400/`invalid_request`; no test
covers that path).

One fix during work: `ApprovalServiceError` from `decideApproval` surfaces as an
Effect defect through `Effect.promise`, which a `try/catch` around `yield*` cannot see
(it 500s). Mapped it with `Effect.catchDefect` (409 expired/not_pending, 403
always_requires_admin, else 400) — same mapping as the old route.

Files changed: `apps/server/src/approvals/api.ts` (new),
`apps/server/src/approvals/routes.ts` (thin wrapper), `apps/server/src/app.ts`
(mount line), `work/T-0553-effect-http-approvals.md` (this report).

Commands and real results:
- `pnpm install`: ok.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot approvals/routes.test.ts`:
  first run 4 failed (500 instead of 409 — the catchDefect issue above); after the fix
  20 passed.
- `... approvals/rules.routes.test.ts`: 23 passed.
- `... approvals actions authz-sweep app.test`: 18 files, 270 tests, all passed.
- `pnpm gate`: GATE PASS — install 5.4s, format, lint, typecheck 0.9s,
  tests @zilar/server 390.6s; "scope: every changed file is inside the Allowed files".

Security checklist: session middleware runs before any decode (401 first); unknown and
unauthorized ids answer the same 404 (`AI not found`, `Group not found`,
`Approval rule not found`); audit rows carry ids only, `note` free text dropped;
no secrets in logs (hook failure logs error name + approvalId only); deletes scoped
(rule visibility + AI-owner/group-admin check before revoke).

No deviations from the spec besides the decode-message text noted above. No open
questions.

## Review (written by Claude)

Approved (lead, 2026-10-08). Approvals and approval rules (6 routes) are served by Effect HttpApi at the same mount position, with the same permission checks, audit calls, 204 on delete and the strict decision body. Lead check: onDecided is still fire-and-forget (void Promise chain with a logged catch), so a throwing hook never changes the decision response. Schemas list all 18 PublicApproval and 8 PublicApprovalRule fields (pre-review count). createApprovalsRoutes stays as the thin wrapper. Pre-review clean; GATE PASS.
