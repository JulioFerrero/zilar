---
id: T-0963
title: "Size split T18: apps/server/src/actions/gateway.ts (1,036 lines) into actions/{decisions,recovery,queries,support}.ts, the old path a barrel; its own runPromise site onto runSql"
status: todo
milestone: M5
branch: task/T-0963-split-server-actions-gateway
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0963: Split `actions/gateway.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/actions/gateway.ts` is 1,036 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #14 (task T18): `actions/decisions.ts`, `actions/recovery.ts`, `actions/queries.ts`, `actions/support.ts`, under `apps/server/src/`. `actions/gateway.ts` becomes the barrel.

**In scope:** the file has one `sqlRuntimeFor(deps.db).runPromise(…)` site (grep for it). It moves onto `runSql` from `apps/server/src/effect/sql.ts:111`, the way other services already call it, with the same behaviour and errors.

**Out of scope:** the entry's cross-file `errorName` Dedup, which is task F6. This is the approvals and permissions gateway, so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #14, `apps/server/src/actions/gateway.ts`, and `apps/server/src/effect/sql.ts`.

### Allowed files
`apps/server/src/actions/gateway.ts`, `apps/server/src/actions/decisions.ts`, `apps/server/src/actions/recovery.ts`, `apps/server/src/actions/queries.ts`, `apps/server/src/actions/support.ts`, `work/T-0963-split-server-actions-gateway.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/approvals/service.test.ts src/approvals/rules.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
