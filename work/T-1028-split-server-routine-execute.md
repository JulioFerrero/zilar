---
id: T-1028
title: "Size split T105: apps/server/src/routines/execute.ts (434 lines) into routines/{outcomes,audit,preflight}.ts, the old path keeps ports, options and executeRoutine"
status: todo
milestone: M5
branch: task/T-1028-split-server-routine-execute
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1028: Split `routines/execute.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/routines/execute.ts` is 434 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #101 (task T105): `routines/outcomes.ts`, `routines/audit.ts` and `routines/preflight.ts`, under `apps/server/src/`. `routines/execute.ts` keeps the ports, the options, `executeRoutine` and re-exports of every name it exports today. The folder already holds `api.ts`, `queries.ts`, `schedule.ts`, `scheduler.ts`, `schemas.ts`, `service.ts`, `support.ts` and `wiring.ts`; leave them as they are.

Move the code unchanged, and skip all three Dedup items. The preflight decides whether a routine may run (approved hosts, pause after failures) and the audit records each run: not one line of either changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #101, and `apps/server/src/routines/execute.ts`.

### Allowed files
`apps/server/src/routines/execute.ts`, `apps/server/src/routines/outcomes.ts`, `apps/server/src/routines/audit.ts`, `apps/server/src/routines/preflight.ts`, `work/T-1028-split-server-routine-execute.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
