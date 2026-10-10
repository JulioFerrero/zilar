---
id: T-0940
title: "Mock backend E1: the AI routes (ais, ai-memory, connections, machines) in @zilar/mock-backend (docs/audit/mock-plan.md task E, part 1)"
status: todo
milestone: M5
branch: task/T-0940-mock-backend-ais
model: auto
effort: default
depends_on: [T-0937]
estimate: 0.5 day
---

# T-0940: Mock backend E1, AIs

## Spec (written by Claude, do not edit)

### Why
This is the first half of task E in `docs/audit/mock-plan.md` section 4 (read the plan and "Julio's answers"). T-0937 (merged) built `packages/mock-backend` with `/me`, `/chats` and `/contacts`.

The web mock routes to port live in `apps/web/src/mock/api.ts`:
- `ais` at `:3021`;
- `ai-memory` at `:2987`;
- `connections` at `:3971`;
- `machines` at `:3994`.

Mobile's twins, which are the cross-check, are `apps/mobile/src/mock/ais.ts` (251 lines) and `apps/mobile/src/mock/ai-memory.ts` (38), plus `apps/mobile/src/components/machines/machines-mock.ts` and `apps/mobile/src/components/connections/connections-mock.ts`.

The seed AIs are `dev-1@ai.zilar.test`, `qa-1@ai.zilar.test` and `marketing@ai.zilar.test` (`apps/web/src/mock/ids.ts:21-25`); the owned AIs are `mockOwnedAis` at `apps/web/src/mock/groups.ts:126`.

### What to build
1. **Route files:** `src/http/ais.ts`, `src/http/ai-memory.ts`, `src/http/connections.ts` and `src/http/machines.ts`. Each answers the contract groups (`packages/api-contract/src/ais.ts`, `ai-memory.ts`, `connections.ts`, `machines.ts`) with the same bodies and mutations as the web mock: create, patch and delete where web supports them. The seed goes in `src/data/ais.ts` (plus more data files if needed).
2. **Keep every file under 400 lines.** Register each route in `src/http.ts` with one line.
3. **No app file changes, no tests.** Prove it in the Report with a throwaway script: `GET` each list, decode it with the contract schema, run one create and one delete on `ais`, and paste the output.

### Read first
`AGENTS.md`, `docs/audit/mock-plan.md`, `packages/mock-backend/src/**`, `apps/web/src/mock/api.ts:2987-3053` and `:3971-4062`, `apps/web/src/mock/groups.ts:120-131`, and the four contract files.

### Allowed files
`packages/mock-backend/**`, `work/T-0940-mock-backend-ais.md`.

T-0939 and T-0941 add other routes to the same package in parallel. Register yours in `src/http.ts` with single lines.

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
