---
id: T-0984
title: "Size split T47: apps/server/src/routines/service.ts (657 lines) into routines/{schemas,queries,support}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0984-split-server-routines-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-0984: Split `routines/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/routines/service.ts` is 657 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #43 (task T47): `routines/schemas.ts`, `routines/queries.ts`, `routines/support.ts`, under `apps/server/src/`. `routines/service.ts` becomes the barrel.

Move the code unchanged, and skip both Dedup items:
- `safeStringify` crosses files;
- the soft-delete helper would merge three SQL statements, which is a separate task.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #43, and `apps/server/src/routines/service.ts`.

### Allowed files
`apps/server/src/routines/service.ts`, `apps/server/src/routines/schemas.ts`, `apps/server/src/routines/queries.ts`, `apps/server/src/routines/support.ts`, `work/T-0984-split-server-routines-service.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
