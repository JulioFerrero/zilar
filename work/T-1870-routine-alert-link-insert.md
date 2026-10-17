---
id: T-1870
title: "Alert link task 3: createRoutine and createPromptRoutine take an optional alertCard {cardId, blockId} and write alert_card_id/alert_block_id in the same INSERT; a block already linked to a live routine creates no row and fails with RoutineServiceError('alert_card_taken'); one test"
status: merged
milestone: M5
branch: task/T-1870-routine-alert-link-insert
model: auto
effort: default
depends_on: [T-1864]
estimate: 30 min
---

# T-1870: Write the alert link when the routine is created (alert link plan, task 3)

## Spec (written by Claude, do not edit)

### Why
**This is task 3 of `docs/plan/alert-card-link.md` §6** (option (a)). The routine row exists only after a person approves `routine.schedule` (§1). So the link must be written in the same `INSERT` that creates the routine. The next task makes the adapter pass it.

### Facts (read by the lead on 2026-10-17)
- **`apps/server/src/routines/schemas.ts`:**
  - `CreateRoutineInput` (`:50-60`) is `{ aiId, groupId, topicId, toolId, title, schedule, input?, approvedHosts, userId }`;
  - `CreatePromptRoutineInput` (`:62-70`) is `{ aiId, groupId, topicId, title, schedule, prompt, userId }`.
- **`routine.schedule` creates either kind:** `createPromptRoutine` (`apps/server/src/tools/routine-adapters.ts:158`) or `createRoutine` (`:206`). An alert can drive either, so both take the link.
- **`apps/server/src/routines/prompt-routines.ts`** (92 lines): `createPromptRoutine` calls `enforceRoutineLimit` (`:52`), inserts at `:58-70` and audits at `:77`.
- **`apps/server/src/routines/support.ts`** (324 lines):
  - `createRoutine` validates, then calls `enforceRoutineLimit` (`:110`);
  - it inserts with one `INSERT INTO routines (...) VALUES (...) RETURNING *` (`:112-136`);
  - it audits `routine.created` (`:140-153`).
  - `RoutineServiceError(code, message)` is the service's typed error. The adapter turns it into the model's summary (`apps/server/src/tools/routine-adapters.ts:226-229`).
- **The link columns and the guard** (`apps/server/drizzle/0074_alert-card-link.sql`): `alert_card_id` and `alert_block_id` are text. A partial unique index on `(alert_card_id, alert_block_id)` applies where the card is set and `deleted_at IS NULL`.
- **`isUniqueViolation`** comes from `apps/server/src/effect/error-utils.ts`. It is used the same way in `apps/server/src/routines/alert-link.ts:23-45`.
- **Row type:** `RoutineRow.alertCardId?: string | null` (`apps/server/src/db/rows-agents.ts:177`), and the matching `alertBlockId`.

### Steps
1. **`schemas.ts`:** add `alertCard?: { cardId: string; blockId: string }` to both `CreateRoutineInput` and `CreatePromptRoutineInput`, with a one-line comment (T-1870, the alert card that drives this routine).
2. **`support.ts` `createRoutine` and `prompt-routines.ts` `createPromptRoutine`:**
   - add `alert_card_id, alert_block_id` to the column list and the values (`NULL, NULL` when `input.alertCard` is absent);
   - catch a unique violation from the `INSERT` (`isUniqueViolation`) and throw `new RoutineServiceError('alert_card_taken', 'That alert card already drives another routine')`. Nothing is inserted and no audit is written;
   - put `alertCard: true` in the audit `detail` when a link was written (ids only, no card text).
   - Share the catch with one tiny helper if that keeps both short. Every file stays at most 400 lines.
3. **Test** (permissions/money area: one card ↔ one routine). Add one new test file, `apps/server/src/routines/alert-link-create.test.ts`. Set it up like `apps/server/src/message-blocks/respond.test.ts:273-290`, which calls `createPromptRoutine` with an AI and its owner from `test-support/seed`:
   - create a prompt routine with `alertCard`; the row has both columns set;
   - a second `createPromptRoutine` with the same pair rejects with `alert_card_taken` and leaves exactly one routine row with that card.

### Allowed files
- `apps/server/src/routines/schemas.ts`
- `apps/server/src/routines/support.ts`
- `apps/server/src/routines/prompt-routines.ts`
- `apps/server/src/routines/alert-link-create.test.ts`
- `apps/server/src/db/rows-agents.ts`
- `work/T-1870-routine-alert-link-insert.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/alert-link-create.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **`createRoutine` and `createPromptRoutine`** with `alertCard` write both link columns in the one `INSERT`; without it, the columns stay `NULL`.
- **A taken block** gives `alert_card_taken` and no new row.
- The test passes, and so does the gate.

---

## Report (written by the worker when done)

### What I did

- `schemas.ts`: added the optional `alertCard?: { cardId: string; blockId: string }` to both `CreateRoutineInput` and `CreatePromptRoutineInput`, with a one-line T-1870 comment.
- `support.ts` `createRoutine`: the single `INSERT INTO routines (...)` now lists `alert_card_id, alert_block_id` and binds the pair (`NULL` when `input.alertCard` is absent). A unique violation from that INSERT is caught with `isUniqueViolation` and rethrown as `RoutineServiceError('alert_card_taken', 'That alert card already drives another routine')`, before any audit is written. The `routine.created` audit `detail` gains `alertCard: true` only when a link was written.
- `prompt-routines.ts` `createPromptRoutine`: the same change in its own INSERT, catch, error and audit detail.
- Added `apps/server/src/routines/alert-link-create.test.ts` (one test): a plain prompt routine keeps both columns `NULL`; a routine created with `alertCard` has both columns set; a second `createPromptRoutine` with the same `{cardId, blockId}` rejects with `errorCode: 'alert_card_taken'` and exactly one live routine row has that pair.
- `apps/server/src/db/rows-agents.ts` needed no change: `alertCardId?` / `alertBlockId?` were already on `RoutineRow` from T-1856.

Deviation: I kept the try/catch inline in both creators rather than adding a shared helper. It is six lines in each file, both files stay well under 400 lines (`support.ts` 340, `prompt-routines.ts` 107), and it keeps the error handling next to the INSERT it guards.

### Checks run

- `pnpm install`: `Done in 29.9s using pnpm v10.32.1`.
- `pnpm --filter @zilar/server exec vitest run src/routines/alert-link-create.test.ts --reporter=dot`: `Test Files 1 passed (1)`, `Tests 1 passed (1)` (7.33s).
- `pnpm gate` (from the repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (1.0s)
  PASS  lint  (1.3s)
  PASS  typecheck  (4.4s)
  PASS  effect  (1.1s)
  PASS  tests @zilar/server  (16.1s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- The catch maps any unique violation from the routine INSERT to `alert_card_taken`. The only unique constraints on `routines` are the `id` primary key (filled from `randomUUID()`) and the T-1870 partial alert-card index, so only the latter can realistically fire.
- The spec's test bullets name `createPromptRoutine` only, so `createRoutine` has no new direct test; it uses the identical INSERT/catch shape.
- Concurrency is already covered by the partial unique index; the test exercises the sequential second-insert path.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `b6a3ae001` (clean, 2 nits, 1 follow-up).
- **The insert:** both create paths write `alert_card_id` and `alert_block_id` in the one `INSERT`, with `NULL` when no card is given.
- **The unique-violation catch** maps to `alert_card_taken`. I checked the migrations: the only other unique key on `routines` is the random UUID primary key, so the mapping is accurate today.
- **Follow-up for the adapter task (T-1871):** `routines/status-errors.ts` maps unknown codes to 400. The adapter path uses `serviceFailure(error)`, so check that the model gets the message there.
