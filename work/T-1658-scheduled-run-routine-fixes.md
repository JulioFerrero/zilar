---
id: T-1658
title: "Scheduled-run fixes, routines side (audit docs/audit/scheduled-path-trace.md G7, G8, G9): refund the daily prompt slot when the run comes back offline or not_in_room, log a warning with ids for those two outcomes, and park a row whose nextRunAfter throws instead of failing the whole tick"
status: merged
milestone: M5
branch: task/T-1658-scheduled-run-routine-fixes
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1658: Scheduled runs: slot refund, offline warning, tick guard

## Spec (written by Claude, do not edit)

### Why
The end-to-end trace (T-1656, `docs/audit/scheduled-path-trace.md` §4) found these gaps on the routines side:
- **G7:** the daily slot is taken **before** the outcome (`apps/server/src/routines/execute-prompt.ts:78-82`). A routine whose AI is offline, or whose room is gone, burns one of the AI's shared 24 daily slots every tick, and can starve its other prompt routines.
- **G8:** `offline` and `not_in_room` are recorded `skipped` with no log line at all, so nobody can tell a routine isn't running.
- **G9:** `nextRunAfter` can throw (`apps/server/src/routines/schedule.ts:177`), and `claimDue` calls it unguarded (`apps/server/src/routines/scheduler.ts:258`), so one bad row fails the whole tick for every routine.

### Facts (the lead read them on 2026-10-16, main after T-1656)
- **`apps/server/src/routines/execute-prompt.ts`** (109 lines):
  - `claimPromptRun(db, aiId, at)` (`:44-62`) runs the atomic `INSERT … ON CONFLICT … WHERE count < 24 RETURNING count`, with the day as `at`'s UTC date;
  - `executePromptRoutine` (`:64-109`): no runner → warn plus `markSkipped`; the claim fails → warn `'prompt routine skipped: daily cap'` plus `markSkipped`; then `runPrompt`, where a throw counts as `'failed'`; then `replied` → `markOk`, `failed` → `recordFailure`, else `markSkipped`.
- **`apps/server/src/routines/scheduler.ts`** (315 lines), `claimDue`:
  - the invalid-schedule branch parks the row one hour out with `UPDATE … SET next_run_at = now + 1h … WHERE id = … AND next_run_at = …` (`:241-257`);
  - then `const advanced = nextRunAfter(parsed.value, nowDate);` (`:258`).

### Steps
1. **G7, `execute-prompt.ts`:** add `refundPromptRun(db, aiId, at)`: `UPDATE routine_prompt_runs SET count = count - 1 WHERE ai_id = … AND day = … AND count > 0`. Call it when the outcome is `'offline'` or `'not_in_room'`. Keep the slot for `limited`, `stopped`, `failed` and `replied`.
2. **G8:** for `'offline'` and `'not_in_room'`, log `options.logger.warn({ routineId: row.id, aiId: row.aiId, outcome }, 'prompt routine skipped: AI not reachable')`, ids only, before `markSkipped`.
3. **G9, `scheduler.ts`:** wrap the `nextRunAfter` call (`:258`) in `try/catch`. On a throw, log `logger.warn({ routineId: row.id }, 'routine schedule could not advance; parking it')`, park the row exactly like the invalid-schedule branch (one hour out, the same CAS update), and `continue`. Reuse the branch's code through a small local function rather than duplicating the SQL.
4. **Tests** in `apps/server/src/routines/execute-prompt.test.ts` (permissions/money):
   - an `'offline'` outcome leaves today's `routine_prompt_runs.count` unchanged (claimed, then refunded);
   - a `'replied'` outcome keeps it incremented.

### Allowed files
- `apps/server/src/routines/execute-prompt.ts`
- `apps/server/src/routines/execute-prompt.test.ts`
- `apps/server/src/routines/scheduler.ts`
- `work/T-1658-scheduled-run-routine-fixes.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/execute-prompt.test.ts src/routines/scheduler.test.ts src/routines/execute.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **G7, G8 and G9 are fixed;** G7 has tests.
- **Tool routines are unchanged.**
- **Every file stays within 400 lines.**

---

## Report (written by the worker when done)

### What I did

- **G7 (`apps/server/src/routines/execute-prompt.ts`):** added `refundPromptRun(db, aiId, at)`, an `UPDATE routine_prompt_runs SET count = count - 1 WHERE ai_id = … AND day = … AND count > 0` keyed on `at`'s UTC day (the same day the claim used). `executePromptRoutine` now calls it when the outcome is `'offline'` or `'not_in_room'`; `limited`, `stopped`, `failed` and `replied` keep the slot.
- **G8 (same file):** for `'offline'` and `'not_in_room'` it logs `options.logger.warn({ routineId: row.id, aiId: row.aiId, outcome }, 'prompt routine skipped: AI not reachable')` before `markSkipped` (ids only, no message text).
- **G9 (`apps/server/src/routines/scheduler.ts`):** extracted the invalid-schedule park SQL into a local `parkOneHourOut(row)` inside `claimDue`, and wrapped `nextRunAfter(...)` in `try/catch`. On a throw it logs `logger.warn({ routineId: row.id }, 'routine schedule could not advance; parking it')`, parks the row one hour out with the same CAS update, and `continue`s, so one bad row no longer fails the tick.
- **Tests (`apps/server/src/routines/execute-prompt.test.ts`):** added a `readPromptRunCount` helper and three cases — `'replied'` leaves today's count at 1; `'offline'` claims then refunds to 0; `'not_in_room'` also refunds to 0 (the last two also assert `last_status = 'skipped'`).
- Tool routines were not touched.

### Checks run

- `pnpm install` — Done in 14.4s.
- `pnpm --filter @zilar/server exec vitest run src/routines/execute-prompt.test.ts src/routines/scheduler.test.ts src/routines/execute.test.ts --reporter=dot` — 3 files, 12 tests, all passed.
- `pnpm gate` — ended in `GATE PASS`:
  - `gate: 4 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

Changed files: `apps/server/src/routines/execute-prompt.ts`, `apps/server/src/routines/execute-prompt.test.ts`, `apps/server/src/routines/scheduler.ts`, `work/T-1658-scheduled-run-routine-fixes.md`.

### Notes for the lead

- No test for G9: `nextRunAfter` only throws for a daily schedule with no occurrence in a week, which `parseRoutineSchedule` cannot produce (weekdays/timezone are validated), so the guard is defensive and not reachable through a parsed schedule. The spec's step 4 only required G7 tests, so I left it. Say the word if you want a test that mocks `nextRunAfter`.
- `refundPromptRun` could drive a row to `count = 0`; the row is left in place (harmless, and the next claim's `ON CONFLICT` increments it again from 0).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit. The two refund tests check the net count but not that the runner ran; accepted, since the claim path has its own test.
- **The fixes:**
  - **G7:** `refundPromptRun` gives the slot back on `offline`/`not_in_room`, with the same UTC day and `ai_id` as the claim and a `count > 0` guard;
  - **G8:** a warning log with ids and the outcome only;
  - **G9:** `claimDue` guards `nextRunAfter` and parks the row through the shared `parkOneHourOut`, so the invalid-schedule branch now uses it too.
- **The tests:** the lead ran `execute-prompt`, `scheduler` and `execute`: 12 passed.
