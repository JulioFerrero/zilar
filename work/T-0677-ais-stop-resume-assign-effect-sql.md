---
id: T-0677
title: "effect/sql: move stopAi, resumeAi, assignMachine and findUserName in ais/service.ts onto effect/sql (same conditional updates, same races, same errors)"
status: merged
milestone: M5
branch: task/T-0677-ais-stop-resume-assign-effect-sql
model: auto
effort: low
depends_on: [T-0671]
estimate: 0.15 day
---

# T-0677: ais stop, resume and assign on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. After T-0671, `ais/service.ts` still uses drizzle in `createAi`, `stopAi`, `resumeAi`, `assignMachine`, `findUserName`, `compensateCreate` and `withAiEnsureLock` (see its header comment). This task takes the four small ones.

### Verified facts (do not re-derive)
- **`apps/server/src/ais/service.ts`** (line numbers from before T-0671 merged; find the functions by name):
  - `stopAi(deps, id, ownerId)`: its one drizzle statement is `UPDATE ais SET status = 'stopped', updated_at = now WHERE id = ai.id AND status = 'active' RETURNING *`. Only `updated.length === 0` is used;
  - `resumeAi`: the same, with `status = 'active' WHERE … AND status = 'stopped'`;
  - `assignMachine(deps, input)`:
    - with `machineId === null`, `UPDATE ais SET machine_id = NULL, updated_at = now WHERE id = ai.id`;
    - otherwise, `SELECT owner_user_id, status FROM machines WHERE id = input.machineId AND owner_user_id = input.ownerId LIMIT 1`, then `UPDATE ais SET machine_id = input.machineId, updated_at = now WHERE id = ai.id`;
  - `findUserName(db, userId)`: `SELECT name FROM "user" WHERE id = userId LIMIT 1`, then `row?.name ?? ''`.
  - Every other line in these functions (the `findOwnedAi` reads, the 404 and 409 errors, the race re-reads, `emitAiLifecycle`) stays.
- **The recipe:** `runSql` (`ais/service.ts:27`), statements written as `` sql`…` ``, timestamps as `${new Date().toISOString()}` (as T-0660 did in this file).
- **Tests:** `apps/server/src/ais/service.test.ts` (`describe('stopAi')` at about line 643 on, plus resume and assign), and `apps/server/src/ais/*.test.ts`.

### What to build
1. **Rewrite the drizzle statements** in the four functions as effect/sql through `runSql`, with the same SQL meaning, the same conditions and the same row-count checks.
2. **Update the header comment's still-drizzle list** (now `createAi`, `compensateCreate`, `withAiEnsureLock`).
3. **Remove** imports that become unused, such as `machines` and `user`, if nothing else uses them.

### Read first
`AGENTS.md`, `apps/server/src/ais/service.ts` (the header, `runSql`, the four functions).

### Allowed files
`apps/server/src/ais/service.ts`, `work/T-0677-ais-stop-resume-assign-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais
pnpm gate
```

### Acceptance
- The four functions have no drizzle calls.
- The ais tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** review. All four functions in `apps/server/src/ais/service.ts` now run on effect/sql through `runSql`.

**What changed (`apps/server/src/ais/service.ts`):**
- `stopAi` and `resumeAi`: the conditional `UPDATE ais` (`WHERE id = ai.id AND status = 'active'` / `'stopped'`) is now a `sql` statement with `RETURNING id`. The `updated.length === 0` race re-read is unchanged. `RETURNING id` replaces `RETURNING *` because only the row count was used.
- `assignMachine`: the clear branch is `UPDATE ais SET machine_id = NULL, updated_at = ...`. The set branch is `SELECT owner_user_id, status FROM machines WHERE id = ... AND owner_user_id = ... LIMIT 1`, then `UPDATE ais SET machine_id = ...`. The `machineId` is captured in a const before the Effect closure so the narrowing holds. The 404s, the same-value early return and the reload are unchanged.
- `findUserName`: `SELECT name FROM "user" WHERE id = ... LIMIT 1` (the table name is `user`, from `apps/server/src/auth/auth-schema.ts:4`).
- Header comment: the still-drizzle list is now `createAi`, `compensateCreate` and `withAiEnsureLock`.
- Imports: `machines` and `user` removed from the schema import, and `and` removed from the drizzle import (no `and(` call is left). `eq` stays (used by `createAi`).
- Timestamps: the spec said `${new Date().toISOString()}` as T-0660 did. `service.ts` has no `toISOString` at all; its existing effect/sql code (`updateAi`, `setPersonaFromChat`) passes `${new Date()}`. I followed the file, so the timestamps are `${new Date()}`.

**Drizzle left in the file:** `createAi` (`.insert`, `.update(ais)` at about line 381), `compensateCreate`, `withAiEnsureLock`. `grep` for `.update(`, `.select(`, `.from(`, `.returning(` shows only line 381.

**Commands run:**
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais`: exit 0. `Test Files 4 passed | 1 skipped (5)`, `Tests 96 passed | 2 skipped (98)`. The skipped file is `integration.test.ts`, gated by `ZILAR_AIS_INTEGRATION=1` and `ZILAR_AI_MODELS_INTEGRATION=1`. It does not cover these functions. The stop, resume and assign paths are covered by `service.test.ts` (`describe('stopAi')`, `describe('resumeAi')`) and `routes.test.ts` (machine assignment and clearing), which run on the test context's real database. No test mocks drizzle in `src/ais`.
- `pnpm gate` (from the worktree root), summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (4.3s)
  PASS  format  (30.7s)
  PASS  lint  (2.1s)
  PASS  typecheck  (6.9s)
  PASS  tests @zilar/server  (19.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- `git diff --stat`: `apps/server/src/ais/service.ts` (+58/-30) and the task file. Nothing else changed, and no scratch files are left in the worktree.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 3.7 min). The lead reviewed the diff directly.
- **Result:** the conditional updates (`status = active` / `stopped`) and the row-count checks are the same, and so are the machine ownership read and the name read. `${new Date()}` matches the rest of the file, so the spec hint about `toISOString` was wrong. `RETURNING id` is enough, since only the count is used. The gate passed.
- **Nit for a follow-up:** the machine row is typed `{ owner_user_id }`, but the client camelCases names. The field is never read, so this is harmless; it could be just `{ status }`.
