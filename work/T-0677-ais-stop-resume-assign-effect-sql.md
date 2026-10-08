---
id: T-0677
title: "effect/sql: move stopAi, resumeAi, assignMachine and findUserName in ais/service.ts onto effect/sql (same conditional updates, same races, same errors)"
status: todo
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

## Review (written by Claude)
