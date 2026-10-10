---
id: T-0941
title: "Mock backend E2: approvals, approval rules, audit, tools and routines routes in @zilar/mock-backend (docs/audit/mock-plan.md task E, part 2)"
status: merged
milestone: M5
branch: task/T-0941-mock-backend-approvals-tools
model: auto
effort: default
depends_on: [T-0937]
estimate: 0.5 day
---

# T-0941: Mock backend E2, approvals and tools

## Spec (written by Claude, do not edit)

### Why
This is the second half of task E in `docs/audit/mock-plan.md` section 4 (read the plan and "Julio's answers"). T-0937 (merged) built `packages/mock-backend`.

The web mock routes to port live in `apps/web/src/mock/api.ts`:
- `approvals` at `:4063`;
- `groups/approval-rules` and `approval-rules` at `:3947-3970`;
- `audit` at `:3920`;
- tools and routines in `toolRoutes` at `:633-824`.

Mobile's twins, which are the cross-check, are `apps/mobile/src/mock/approvals.ts` (129 lines), `audit.ts` (83) and `tools.ts` (369). The seed keeps one pending approval (plan section 2.5).

### What to build
1. **Route files:** `src/http/approvals.ts`, `src/http/approval-rules.ts`, `src/http/audit.ts`, `src/http/tools.ts` and `src/http/routines.ts`. Each answers its contract group (`packages/api-contract/src/approvals.ts`, `audit.ts`, `tools.ts`, `routines.ts`) with the same bodies and mutations as the web mock: approve or deny, rule edits, tool and routine create, patch and delete. The seed goes in `src/data/approvals.ts`, `src/data/tools.ts` and `src/data/audit.ts`.
2. **Keep every file under 400 lines.** Register each route in `src/http.ts` with one line.
3. **No app file changes, no tests.** Prove it in the Report with a throwaway script: `GET` each list and decode it with the contract schema, approve the pending approval and show that it left the pending list, and create one tool. Paste the output.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/**`, `apps/web/src/mock/api.ts:633-824`, `:3920-3970` and `:4063-4126`, and the four contract files.

### Allowed files
`packages/mock-backend/**`, `work/T-0941-mock-backend-approvals-tools.md`.

T-0939 and T-0940 add other routes to the same package in parallel. Register yours in `src/http.ts` with single lines.

### Checks
```bash
pnpm --filter @zilar/mock-backend typecheck
pnpm gate
```

### Acceptance
- The Checks pass, and only `packages/mock-backend` changes.
- Every file is under 400 lines.
- The Report has the decoded responses.

---

## Report (written by the worker when done)

### What I did

Ported task E2 of `docs/audit/mock-plan.md` into `@zilar/mock-backend`: the
approvals, approval-rules, audit, tools and routines routes, with their seeds.

- New route files: `src/http/approvals.ts` (list, detail, decision),
  `src/http/approval-rules.ts` (AI rules, group rules, revoke), `src/http/audit.ts`
  (list by `aiId`/`groupId`), `src/http/tools.ts` (list by AI/group/topic,
  detail, versions, one version, runs, revert, run, delete) and
  `src/http/routines.ts` (list by AI/group, pause, resume, delete). Behaviours
  and bodies mirror web's `mock/api.ts` (`toolRoutes` `:633`, `audit` `:3920`,
  `approval-rules` `:3947`, `approvals` `:4063`).
- New seeds: `src/data/approvals.ts` (the one pending `apr-42` card),
  `src/data/tools.ts` (web's two tools / two routines / two runs) and
  `src/data/audit.ts` (web's eight audit rows, timestamps relative to `now`).
- Extended `src/data/index.ts`, `src/state.ts` and `src/index.ts` with the new
  seed tables and types, added `errorResponse`/`noContent` to `src/http/shared.ts`,
  and registered the five handlers in `src/http.ts` (one import line and one
  `routes` entry each). Every file is under 400 lines (largest: `http/tools.ts`
  205).
- No app files changed, no tests added.

### Files changed

- `packages/mock-backend/src/data/{approvals,tools,audit}.ts` (new)
- `packages/mock-backend/src/http/{approvals,approval-rules,audit,tools,routines}.ts` (new)
- `packages/mock-backend/src/data/index.ts`, `src/state.ts`, `src/index.ts`,
  `src/http.ts`, `src/http/shared.ts` (edited)
- `work/T-0941-mock-backend-approvals-tools.md`

### Commands and results

`pnpm --filter @zilar/mock-backend typecheck` → passed (no output).

`pnpm gate` (from the repo root):

```
gate: 14 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.3s)
PASS  lint  (0.7s)
PASS  typecheck  (1.9s)
PASS  effect  (1.0s)
SKIP tests @zilar/mock-backend (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

`SKIP tests` is correct: the package has no test files (the task says no tests).

Throwaway proof script (`pnpm exec tsx`, run against `createMockBackend()`, then
deleted). It decodes every response with the contract schemas
(`PublicApproval`, `ApprovalRule`, `AuditPage`, `ToolListItem`, `ToolDetail`,
`ToolVersion`, `ToolVersionDetail`, `ToolRun`, `ToolRunResult`, `Routine`).
Real output:

```
GET /api/approvals decoded: ["apr-42/pending"]
GET /api/audit?aiId=dev-1 decoded: {"count":4,"ids":["audit-dev-approval","audit-dev-resumed","audit-dev-stopped","audit-devteam-approval"],"next":null}
GET /api/audit?groupId=g-devteam decoded: {"count":2,"ids":["audit-devteam-approval","audit-devteam-deny"]}
GET /api/ais/dev-1/tools decoded: ["tool-mock-prices@v2","tool-mock-notes@v2"]
GET /api/tools/tool-mock-prices decoded: {"id":"tool-mock-prices","currentVersion":2,"source":"export function run(inpu"}
GET /api/tools/tool-mock-prices/versions decoded: [2,1]
GET /api/tools/tool-mock-prices/versions/2 decoded: {"version":2,"message":"Add the price host"}
GET /api/tools/tool-mock-prices/runs decoded: ["run-mock-1/ok","run-mock-2/error"]
GET /api/ais/dev-1/routines decoded: ["routine-mock-morning/active","routine-mock-standup/paused"]
GET /api/groups/g-devteam/routines decoded: 2
POST /api/approvals/apr-42/decision decoded: {"id":"apr-42","status":"approved_once","decidedAt":true}
GET /api/approvals after decision: 0
POST /api/tools/tool-mock-prices/revert decoded (creates a new version): {"id":"tool-mock-100","version":3,"message":"Revert to v1","toolName":"prices"}
GET runs after revert: 2
POST /api/tools/tool-mock-prices/run decoded: {"ok":true,"output":{"text":"mock output of prices v3"},"logs":"","durationMs":42,"fetchCount":0}
GET runs after run: 3
POST second decision status: 409
approve_always decoded: {"status":"approved_always"}
GET /api/ais/dev-1/approval-rules decoded: ["rule-apr-42-merge_pull_request"]
GET /api/groups/g-devteam/approval-rules decoded: 0
DELETE /api/approval-rules/:id status: 204
GET /api/audit with both params status: 400
```

So: every list decodes with its contract schema, approving `apr-42` moves it off
the pending list (approvals list went from `["apr-42/pending"]` to `0`), a second
decision answers 409, `approve_always` records the standing rule (and the
AI-rules route lists it, the group-rules route is empty, delete is 204), and the
audit route enforces "exactly one of aiId/groupId" (400).

### Deviations from the spec (and why)

- **The spec's "tool and routine create, patch and delete" does not exist in the
  contract or the web mock.** `ToolsGroup` (`packages/api-contract/src/tools.ts`)
  and `RoutinesGroup` (`routines.ts`) have no create/patch endpoints; web's
  `toolRoutes` serves only GET, `POST revert`, `POST run` and `DELETE` for tools,
  and list/pause/resume/delete for routines. I implemented exactly those (same as
  web, per the spec's "same bodies and mutations as the web mock"). The proof's
  "create one tool" is therefore done with the only tool-creating mutation that
  exists, `POST /tools/:id/revert`, which created version 3
  (`tool-mock-100`); `POST /tools/:id/run` also created a run row (2 → 3).
- **Ids use the unified JID-localpart scheme**, not web's mixed `ai-mock-dev` vs
  `dev-1`: tools/routines/audit use `dev-1`, `qa-1`, `marketing`, matching
  `src/data/people.ts`, web's `mockOwnedAis`/topics, and the plan's one JID-keyed
  seed. This is a **cross-task dependency on T-0940**: the AI rows it seeds must
  use these ids for the AI-scoped lists to match. If T-0940 picks `ai-mock-dev`
  instead, the ids need one small alignment.
- **`GET /groups/:id/approval-rules` omits web's membership check.** Web resolves
  the group from `mockGroupDetails` and 404s a non-manager; this package has no
  groups table yet (task D). Since the mock has a single owner user, the route
  returns the group's rules (empty until an `approve_always` creates one), which
  is what web answers for the owner.
- **`GET /ais/:id/tools|routines` does not 404 an unknown AI.** Web checks
  `toolAiIds()` against the seeded AIs; this package has no AIs table yet (task
  E1/T-0940), so the routes return the filtered list (empty for an unknown id).
  Noted for T-0940.

### Tests

No tests, per the task. The throwaway script above is the proof and was deleted
before the gate.

---

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 4 nits.**
- **Routes:** approvals, approval rules, audit, tools and routines in `packages/mock-backend`. 1,094 lines added, with no file over 205, and only the package changed.
- **Nits for the mock follow-ups:**
  - a wrong "idempotent" comment on tool `DELETE`;
  - list filters compare raw segments, without decoding;
  - audit `limit` is parsed with `parseInt` where web uses `Number`;
  - the disclosed small deviations (an unknown-AI list returns `[]`; group rules skip the membership check).
- **Check:** the gate passed.
