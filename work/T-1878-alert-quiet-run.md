---
id: T-1878
title: "Alert quiet run (alert link plan task 5): a tool routine linked to an alert card reads the tool's numeric output.data.value; below input.threshold the run is ok and posts nothing; at or above it posts the normal routine message (later runs edit it); no number or no threshold counts as a failure; one test"
status: merged
milestone: M5
branch: task/T-1878-alert-quiet-run
model: auto
effort: default
depends_on: [T-1870]
estimate: 35 min
---

# T-1878: The alert routine posts only when the threshold is reached

## Spec (written by Claude, do not edit)

### Why
**The alert card promises "tell me when X passes Y"** (`docs/plan/alert-card.md` §1, §5 step 4). Today a routine run always posts its output (`docs/plan/alert-card.md` §2.4). So a routine linked to an alert card must stay quiet below the threshold, and speak once it is reached. This is task 5 of `docs/plan/alert-card-link.md` §6, and the message pipeline, so it gets one test. The card's "Checked … · now …" note is the next task.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/routines/execute.ts`** (228 lines), `executeRoutine` (`:108-228`):
  - the AI and room preflight;
  - prompt routines branch off (`:142-145`);
  - step 4 runs the tool and keeps `outputText`, `outputBlocks` and `outputCard` from `result.output` (`:178-210`), with `recordFailure` on `!result.ok`;
  - step 5 posts with one retry, then `markOk` (`:212-228`).
- **The tool output** is `{ text, data?, blocks?, card? }` (`apps/server/src/tools/types.ts:10-17`).
- **The link:** `RoutineRow.alertCardId` (`apps/server/src/db/rows-agents.ts:177`) is set when the routine drives an alert card (T-1870). The threshold is a number in `row.input.threshold`, written by `setRoutineThreshold` with `to_jsonb(...::double precision)` (`apps/server/src/routines/alert-link.ts:70-90`).
- **Outcomes:** `markOk(db, options, row, at, startedAt)` (`apps/server/src/routines/outcomes.ts:110-128`) and `recordFailure(db, options, ports, row, at, startedAt)` (`:132-140`; the 3rd consecutive failure pauses the routine).
- **Tests:** `apps/server/src/routines/execute.test.ts` (126 lines) drives `executeRoutine` with a fake `runTool` (`:69-126`).

### Steps
1. **New `apps/server/src/routines/alert-run.ts`:** `alertVerdict(input: unknown, data: unknown)` → `{ kind: 'post'; value: number } | { kind: 'quiet'; value: number } | { kind: 'error' }`.
   - The value is `data.value` when it is a finite number.
   - The threshold is `input.threshold` when it is a finite number.
   - Either missing → `error`.
   - `value >= threshold` → `post`; otherwise `quiet`.
2. **`execute.ts`:** keep `result.output.data` from step 4. Then, before step 5, when `row.alertCardId` is set (not null or undefined), compute the verdict:
   - `error` → `recordFailure(...)` and return;
   - `quiet` → `markOk(...)` and return, posting nothing;
   - `post` → continue to step 5 unchanged.

   Routines without a link behave exactly as today. Keep `execute.ts` at most 400 lines.
3. **Test:** one new `it` in `execute.test.ts`, with a linked tool routine whose `input` is `{ threshold: 90000 }`:
   - `data: { value: 82302 }` → the post port is never called and the routine's `last_status` is `ok`;
   - `data: { value: 91000 }` → posted once;
   - `data: {}` → `consecutive_failures` becomes 1 and nothing is posted.

### Allowed files
- `apps/server/src/routines/alert-run.ts`
- `apps/server/src/routines/execute.ts`
- `apps/server/src/routines/execute.test.ts`
- `work/T-1878-alert-quiet-run.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/execute.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **A linked alert routine** posts only at or above its threshold.
- **Below it,** the run is `ok` and silent.
- **No number** counts toward the 3-failure pause.
- **Unlinked routines** are unchanged.
- The test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did
- **`apps/server/src/routines/alert-run.ts`** (new): `alertVerdict(input, data)` returns `post` when the finite `data.value` is at or above the finite `input.threshold`, `quiet` when below, and `error` when either number is missing or not finite.
- **`apps/server/src/routines/execute.ts`**: step 4 now also keeps `result.output.data`. Before step 5, when `row.alertCardId` is set (`!= null`), `error` calls `recordFailure` and returns, `quiet` calls `markOk` and returns without posting, and `post` continues to step 5 unchanged. Unlinked routines take exactly the old path. The file is 250 lines.
- **`apps/server/src/routines/execute.test.ts`**: `seedRoutine` accepts optional `routineInput` and `alertCardId`; a new `it` seeds a linked routine with `{ threshold: 90000 }` and runs it three times: `data: { value: 82302 }` posts nothing and leaves `last_status = 'ok'`, `data: { value: 91000 }` posts once, and `data: {}` posts nothing and leaves `consecutive_failures = 1`.
- Changes are limited to the four Allowed files.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/execute.test.ts`: 1 file passed, 2 tests passed (9.30s).
- `pnpm gate` (first run): FAIL on format — Prettier wanted `alert-run.ts` reformatted; every other step passed and scope was clean.
- `pnpm exec prettier --write apps/server/src/routines/alert-run.ts`: reformatted that one file.
- `pnpm gate` (second run): GATE PASS
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server (25.3s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

### Notes for the lead
- No deviations from the spec. A non-finite number (NaN/Infinity) counts as missing, so it is an `error` like an absent one.
- Security checklist: no new routes, logs, secrets, queries or audit fields; the run keeps its existing ids-only audit entries.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `573695246`.
- **`alertVerdict`** is a pure function of `input.threshold` and `data.value`, both finite numbers.
- **The linked-routine branch** sits between the tool run and the post:
  - error → `recordFailure`;
  - quiet → `markOk` with no post;
  - post → the normal post.

  Unlinked routines are unchanged.
- **The test** covers below (silent, `ok`), above (posted once) and no number (one failure).
- **Next:** the card's "Checked every … · now …" note (link plan task 6).

