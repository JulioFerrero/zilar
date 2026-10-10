---
id: T-0941
title: "Mock backend E2: approvals, approval rules, audit, tools and routines routes in @zilar/mock-backend (docs/audit/mock-plan.md task E, part 2)"
status: todo
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

## Review (written by Claude)
