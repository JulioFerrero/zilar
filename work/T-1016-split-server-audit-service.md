---
id: T-1016
title: "Size split T82: apps/server/src/audit/service.ts (514 lines) into audit/{schema,recorder,list}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-1016-split-server-audit-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1016: Split `audit/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/audit/service.ts` is 514 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #78 (task T82): `audit/schema.ts`, `audit/recorder.ts`, `audit/list.ts`, under `apps/server/src/`. `audit/service.ts` keeps `MAX_AUDIT_LIST_LIMIT` and becomes the barrel.

Move the code unchanged, and skip all three Dedup items, because they cross files. Who may read which audit entries (the group-admin and private-topic filters in the list) is permissions code: not one line of it changes.

Three kept tests import `../audit/service`:
- `apps/server/src/approvals/rules.test.ts`;
- `apps/server/src/approvals/sweeper.test.ts`;
- `apps/server/src/invite-links/invite-links.test.ts`.

They must pass unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #78, and `apps/server/src/audit/service.ts`.

### Allowed files
`apps/server/src/audit/service.ts`, `apps/server/src/audit/schema.ts`, `apps/server/src/audit/recorder.ts`, `apps/server/src/audit/list.ts`, `work/T-1016-split-server-audit-service.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/approvals/rules.test.ts src/approvals/sweeper.test.ts src/invite-links/invite-links.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
