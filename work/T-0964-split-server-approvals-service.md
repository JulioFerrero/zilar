---
id: T-0964
title: "Size split T19: apps/server/src/approvals/service.ts (1,030 lines) into approvals/{schemas,queries,access}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0964-split-server-approvals-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0964: Split `approvals/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/approvals/service.ts` is 1,030 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #15 (task T19): `approvals/schemas.ts`, `approvals/queries.ts`, `approvals/access.ts`, under `apps/server/src/`. `approvals/service.ts` becomes the barrel.

`access.ts` (`canDecide`, `canDecideMany`, `decisionToStatus` and `safeHashEquals`) is permissions code, so move it unchanged. Skip the entry's cross-file `group_members` Dedup, which is task F5.

T-0963 splits `actions/gateway.ts` at the same time; do not touch it.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #15, and `apps/server/src/approvals/service.ts`.

### Allowed files
`apps/server/src/approvals/service.ts`, `apps/server/src/approvals/schemas.ts`, `apps/server/src/approvals/queries.ts`, `apps/server/src/approvals/access.ts`, `work/T-0964-split-server-approvals-service.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/approvals/service.test.ts src/approvals/rules.test.ts src/approvals/sweeper.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
