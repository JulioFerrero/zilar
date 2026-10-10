---
id: T-1036
title: "Size split T116: apps/server/src/routines/api.ts (409 lines) into routines/{wire,access,reads,status-errors}.ts, api.ts keeps deps, handlers, changeStatus and mount"
status: todo
milestone: M5
branch: task/T-1036-split-server-routines-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1036: Split `routines/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/routines/api.ts` is 409 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #112 (task T116). The new files go in `apps/server/src/routines/`: `wire.ts`, `access.ts`, `reads.ts` and `status-errors.ts`. `api.ts` keeps the deps, the handlers, `changeStatus`, the mount and every export it has today; `apps/server/src/app.ts` imports it.

- **Existing files:** the folder already holds `audit.ts`, `execute.ts`, `outcomes.ts`, `preflight.ts`, `queries.ts`, `schedule.ts`, `scheduler.ts`, `schemas.ts`, `service.ts`, `support.ts` and `wiring.ts`. Leave them as they are, and note that `wire.ts` is a new, different file from `wiring.ts`.
- **Move unchanged:** move the code as it is, and skip both Dedup items. `accessFor` and `deletedAccessFor` decide who may manage a routine, which is permissions code: not one line of them changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #112, and `apps/server/src/routines/api.ts`.

### Allowed files
`apps/server/src/routines/api.ts`, `apps/server/src/routines/wire.ts`, `apps/server/src/routines/access.ts`, `apps/server/src/routines/reads.ts`, `apps/server/src/routines/status-errors.ts`, `work/T-1036-split-server-routines-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
