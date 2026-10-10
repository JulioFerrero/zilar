---
id: T-0957
title: "Size split T14: apps/server/src/topics/service.ts (1,127 lines) into topics/{schemas,members,roles,ais,queries}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0957-split-server-topics-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0957: Split `topics/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/topics/service.ts` is 1,127 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #10 (task T14): `topics/schemas.ts`, `topics/members.ts`, `topics/roles.ts`, `topics/ais.ts`, `topics/queries.ts`, under `apps/server/src/`. `topics/service.ts` becomes the barrel.

Skip the entry's cross-file dedup items (`isUniqueViolation` → `handles/store.ts`, and `mapXmppError`); they belong to the F tasks. This is permissions code (topic access and roles), so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #10, and `apps/server/src/topics/service.ts`.

### Allowed files
`apps/server/src/topics/service.ts`, `apps/server/src/topics/schemas.ts`, `apps/server/src/topics/members.ts`, `apps/server/src/topics/roles.ts`, `apps/server/src/topics/ais.ts`, `apps/server/src/topics/queries.ts`, `work/T-0957-split-server-topics-service.md`.

### Checks
```bash
pnpm gate
```
The gate runs the nearest server tests.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
