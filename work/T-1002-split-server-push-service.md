---
id: T-1002
title: "Size split T64: apps/server/src/push/service.ts (561 lines) into push/{delivery,archive-scan,candidates}.ts, the old path keeps types and re-exports"
status: todo
milestone: M5
branch: task/T-1002-split-server-push-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1002: Split `push/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/push/service.ts` is 561 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #60 (task T64): `push/delivery.ts`, `push/archive-scan.ts`, `push/candidates.ts`, under `apps/server/src/`. `push/service.ts` keeps the deps and outcome types, the TaggedErrors, and re-exports of every name it exports today.

Move the code unchanged, and skip all three Dedup items, because they cross files. This is the push path of the message pipeline: who gets a notification and when must not change. The folder already holds other files; leave them as they are.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #60, and `apps/server/src/push/service.ts`.

### Allowed files
`apps/server/src/push/service.ts`, `apps/server/src/push/delivery.ts`, `apps/server/src/push/archive-scan.ts`, `apps/server/src/push/candidates.ts`, `work/T-1002-split-server-push-service.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
