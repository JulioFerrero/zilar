---
id: T-0984
title: "Size split T47: apps/server/src/routines/service.ts (657 lines) into routines/{schemas,queries,support}.ts, the old path a barrel"
status: merged
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

### What I did

Split `apps/server/src/routines/service.ts` (657 lines) into three modules and
left the old path a barrel, following `docs/audit/split-rules.md` and
`docs/audit/size-plan.md` §2.2 #43:

- `routines/schemas.ts` — the limits (`MAX_ROUTINES_PER_TOPIC`,
  `MAX_ROUTINE_TITLE_CHARS`, `MAX_ROUTINE_INPUT_BYTES`), `RoutineServiceError`,
  the status/row types, `CreateRoutineInput`/`PublicRoutine`, the private row
  types, `titleSchema` and `firstIssueMessage`.
- `routines/queries.ts` — the reads (`getRoutine`, `listRoutinesForAi`,
  `listRoutinesForTopic`), the row→view mapping (`toPublicRoutine`,
  `toPublicRoutines`) and the limit check (`enforceRoutineLimit`).
- `routines/support.ts` — the mutations (`createRoutine`, `pauseRoutine`,
  `resumeRoutine`, `deleteRoutine`, `deleteRoutinesForAiInTopic`,
  `deleteRoutinesForAiInGroupEffect`, `deleteRoutinesForTool`) and
  `safeStringify`.
- `routines/service.ts` — barrel only; re-exports the 23 names it always did.

Code moved unchanged. Both Dedup items from the plan entry were skipped as the
task spec requires: `safeStringify` stays in `support.ts` (it crosses files),
and the three soft-delete helpers stay separate (merging them is a separate
task).

### Deviations from the plan entry (both keep every new file ≤400)

- The plan's `schemas.ts` range is 33–143. I also put the constants (19–21) and
  `RoutineServiceError` (23–31) there: they are shared across all three
  modules, and putting them in `support.ts` would create a `schemas → support`
  cycle.
- The plan's `support.ts` came out at 402 lines (over the 400 limit of
  `split-rules.md` item 4), so I moved the three exported result interfaces
  (`PauseRoutineResult`, `ResumeRoutineResult`, `DeleteRoutineResult`) into
  `schemas.ts`, the natural home for types. No fourth file was added.

Private helpers that are now used across files (`titleSchema`,
`firstIssueMessage`, `enforceRoutineLimit`, `toPublicRoutine`,
`toPublicRoutines`, the three row types) are exported from their new module so
the other new files can import them; they are not re-exported by the barrel.

### Files changed

`apps/server/src/routines/service.ts`, `apps/server/src/routines/schemas.ts`,
`apps/server/src/routines/queries.ts`, `apps/server/src/routines/support.ts`,
`work/T-0984-split-server-routines-service.md` (all inside Allowed files).

### Size (`wc -l`)

- old `routines/service.ts`: 657
- new `routines/service.ts` (barrel): 43
- new `routines/schemas.ts`: 144
- new `routines/queries.ts`: 150
- new `routines/support.ts`: 391

### Export list, before vs after

`grep -E "^export"` on the old file gives 23 exports; the barrel re-exports the
same 23 names with the same kinds (9 values, 14 types), checked with a small
regex extractor (old count 23, barrel count 23, `only in OLD: []`):

```
before (23): MAX_ROUTINES_PER_TOPIC, MAX_ROUTINE_TITLE_CHARS,
  MAX_ROUTINE_INPUT_BYTES, RoutineServiceError, RoutineStatus,
  RoutinePausedReason, RoutineLastStatus, RoutineRow, CreateRoutineInput,
  PublicRoutine, createRoutine, getRoutine, listRoutinesForAi,
  listRoutinesForTopic, PauseRoutineResult, pauseRoutine,
  ResumeRoutineResult, resumeRoutine, DeleteRoutineResult, deleteRoutine,
  deleteRoutinesForAiInTopic, deleteRoutinesForAiInGroupEffect,
  deleteRoutinesForTool
after: identical set; kinds preserved (values re-exported with `export {}`,
  types with `export type {}`).
```

The new submodules additionally export 8 names they need across files (the
three row types plus `titleSchema`, `firstIssueMessage`, `enforceRoutineLimit`,
`toPublicRoutine`, `toPublicRoutines`); the barrel does not re-export them, so
the public surface is unchanged.

### Commands run

- `pnpm install` — done.
- `pnpm gate` (from the repo root) — twice, both green:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (5.5s)
PASS  format  (2.7s)
PASS  lint  (0.8s)
PASS  typecheck  (2.8s)
PASS  effect  (0.7s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

No single test file was run: no test in the repo imports `routines/service`,
`routines/schedule` or any routine name, and the gate reported "no nearby test
files" for `@zilar/server`.

### Problems / open questions

None. No importer changed (the barrel absorbed everything); no new
dependencies; no `any` or `@ts-ignore`; no secrets touched.


## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `routines/service.ts` (657 lines) becomes the barrel plus `schemas`, `queries` (150) and `support` (391). The code moved unchanged.
- **The nit:** `support.ts`'s header comment still names the result types, which moved to `schemas.ts`. It's left for a later docs pass.
- **Check:** the gate passed.
