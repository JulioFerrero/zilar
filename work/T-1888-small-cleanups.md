---
id: T-1888
title: "Clean-ups: RoutineRow.alertCardId/alertBlockId become required `string | null` (fixtures add nulls); delete the unused PeopleSearch.setFound on the phone"
status: merged
milestone: M5
branch: task/T-1888-small-cleanups
model: auto
effort: default
depends_on: [T-1880]
estimate: 15 min
---

# T-1888: Two small clean-ups

## Spec (written by Claude, do not edit)

### Why
These are left-overs from the alert-card and people-search work, noted by the lead's reviews on 2026-10-17.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/db/rows-agents.ts:174-178`:**
  - `alertCardId?: string | null; alertBlockId?: string | null;` were left optional "only so test fixtures outside this task's files still build a row" (T-1856);
  - the migration has landed, so every read row carries both columns.
- **Code that builds a `RoutineRow` by hand:**
  - `apps/server/src/agents/gateway/routine-send.test.ts:22` (`routineRow()`);
  - `apps/server/src/routines/blocks-post.test.ts`;
  - `apps/server/src/routines/execute.test.ts`.
- **Readers with `?? null`:**
  - `apps/server/src/routines/alert-note.ts` (`row.alertCardId ?? null`);
  - `apps/server/src/routines/execute.ts`.
- **`apps/mobile/src/components/contacts/people-search.ts:136-141` `setFound`** has no caller anywhere in `apps/mobile/src`.

### Steps
1. **In `rows-agents.ts`:**
   - make both fields required: `alertCardId: string | null; alertBlockId: string | null;`;
   - reword the comment: "T-1856: the alert card block that drives this routine; both null when none is linked."
2. **The three test files:** add `alertCardId: null, alertBlockId: null` to each hand-built row (only where typecheck asks).
3. **Readers:** in `alert-note.ts` and `execute.ts`, drop `?? null` on these two fields if it's now redundant. Change nothing else.
4. **Delete `setFound`** from `people-search.ts`.
5. **If typecheck names any other file,** fix it only if it is in the Allowed list; otherwise stop and say so in your Report.

### Allowed files
- `apps/server/src/db/rows-agents.ts`
- `apps/server/src/agents/gateway/routine-send.test.ts`
- `apps/server/src/routines/blocks-post.test.ts`
- `apps/server/src/routines/execute.test.ts`
- `apps/server/src/routines/alert-note.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/tools/routine-schedule-prompt.test.ts`
- `apps/server/src/routines/alert-link-create.test.ts`
- `apps/mobile/src/components/contacts/people-search.ts`
- `work/T-1888-small-cleanups.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Both fields are required,** and no behaviour changes.
- **`setFound` is gone.**
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- `apps/server/src/db/rows-agents.ts`: `alertCardId` and `alertBlockId` on `RoutineRow` are now required `string | null`; replaced the "optional only so test fixtures … still build a row" comment with "T-1856: the alert card block that drives this routine; both null when none is linked."
- `apps/server/src/agents/gateway/routine-send.test.ts` and `apps/server/src/routines/blocks-post.test.ts`: added `alertCardId: null, alertBlockId: null` to the hand-built `routineRow()` fixtures.
- `apps/server/src/routines/alert-note.ts`: dropped the redundant `?? null` on both fields.
- `apps/server/src/routines/execute.ts`: no change needed — it reads `row.alertCardId` with `!= null`, not `?? null`.
- `apps/server/src/routines/execute.test.ts`: no change needed — its rows are inserted through SQL and returned as `RoutineRow`, so typecheck did not ask for the fields. The other two allowed test files (`routine-schedule-prompt.test.ts`, `alert-link-create.test.ts`) already carried the fields and needed nothing.
- `apps/mobile/src/components/contacts/people-search.ts`: deleted the unused `setFound` method; `HandleProfile` is still used elsewhere in the file.

### Checks run

`pnpm install --frozen-lockfile`: done in 20.7s.

`pnpm gate` (real tail):

```
gate: 6 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.7s)
PASS  lint  (1.0s)
PASS  typecheck  (4.8s)
PASS  effect  (0.7s)
SKIP tests @zilar/mobile (no nearby test files)
PASS  tests @zilar/server  (12.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

I did not run any single test file separately; the gate's `tests @zilar/server` step is the only test run I did.

### Notes for the lead

No behaviour changes. `execute.ts` and `execute.test.ts` are in the Allowed list but needed no edits, as explained above. No files outside the Allowed list were touched.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `ea7d6f3cf`.
- **Dropping `?? null` in `alert-note.ts` is safe:** every read typed `RoutineRow` is `SELECT *` or `RETURNING *`. The lead checked `routines/reads.ts`, `queries.ts`, `support.ts`, `scheduler.ts`, `alert-link.ts` and `prompt-routines.ts`. So both columns are always present, and a non-alert routine still returns early on `null`.
- **`setFound` had no caller.**

