---
id: T-0648
title: "effect/sql: the three self-contained transactions in ais/service.ts (updateAi :402, setPersonaFromChat :465, revertPersonaFromChat :490) move to sql.withTransaction; the rest of the file stays on drizzle; same tests"
status: todo
milestone: M5
branch: task/T-0648-ais-update-persona-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0648: ais update and persona transactions on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. This is the first half of C3b in the T-0626 last-mile audit (`docs/audit/effect-last-mile.md`). None of these three transactions takes a transaction from a caller, so each one converts on its own.

### Verified facts (do not re-derive)
- **`apps/server/src/ais/service.ts`** (1246 lines) imports `and, asc, eq, sql` from `drizzle-orm` (line 2) and seven tables from `../db/schema` (line 7). It has no `runSql` yet. `usd(value: number): string` is at line 1169.
- **The three transactions:**
  - `updateAi`, lines 402-437. If any of `name`, `persona`, `canDelegate` or `acceptsDelegation` is defined, it updates those `ais` columns plus `updatedAt: new Date()` where `id = ai.id`. If `input.limits` is defined, it updates `ai_limits` (`per_day_usd = usd(perDayUsd)`, `per_month_usd = usd(perMonthUsd)`, `updated_at`) and `llm_virtual_keys` (`budget_usd = usd(perMonthUsd)`), both where `ai_id = ai.id`.
  - `setPersonaFromChat`, lines 465-478: selects `persona` for the id, throws `new Error(`AI ${aiId} not found`)` if there is no row, then sets `previous_persona = old persona`, `persona = trimmed`, `updated_at`.
  - `revertPersonaFromChat`, lines 490-509: selects `persona` and `previous_persona`, with the same throw. It returns `'nothing to undo'` when `previous_persona` is null; otherwise it swaps the two and returns `'restored'`.
- **Columns** (`apps/server/src/db/schema.ts:552-610` and `:1056-1065`):
  - `ais`: `name`, `persona`, `previous_persona`, `can_delegate`, `accepts_delegation` and `updated_at`, all NOT NULL except `previous_persona`;
  - `ai_limits`: `ai_id`, `per_day_usd` and `per_month_usd` (both numeric), and `updated_at`;
  - `llm_virtual_keys`: `ai_id` and `budget_usd` (numeric).
- **The recipe:**
  - `apps/server/src/actions/production-announcer.ts:46-51`: a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise(effect)`;
  - `apps/server/src/agents/memory/store.ts:390-410`: `sql.withTransaction(Effect.gen(...))`, with values interpolated as `${value}`.
  - A plain `Error` thrown inside the transaction must reach the caller unchanged. Raise it with `Effect.fail(new Error(...))` and keep the caught type the same, as earlier tasks did for `HttpError`.
- **Tests:**
  - `apps/server/src/ais/service.test.ts`: `updateAi` at about lines 396 and 424;
  - `apps/server/src/agents/tools.test.ts`: the persona tools, through `agents/gateway/tool-exec.ts`.

### What to build
1. **Add a private `runSql`** to `ais/service.ts`, importing `Effect`, `SqlClient`, `SqlError` and `sqlRuntimeFor` as in `production-announcer.ts`.
2. **Convert each of the three transactions** to `runSql(db, Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; return yield* sql.withTransaction(...) }))`.
   - Keep the same statements, the same order and the same conditions.
   - For the `updateAi` partial update, `SET name = COALESCE(${input.name ?? null}, name), …` is fine, because every one of those columns is NOT NULL.
   - Write `updated_at` as `${new Date()}`, as today.
3. **Keep every function signature, return value and error message.** Leave the rest of the file on drizzle; the other transactions are a later task. Change no test.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/actions/production-announcer.ts` (lines 1-60), `apps/server/src/agents/memory/store.ts` (lines 370-420), `apps/server/src/ais/service.ts` (lines 1-20, 350-520 and 1160-1175).

### Allowed files
`apps/server/src/ais/service.ts`, `work/T-0648-ais-update-persona-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/service src/agents/tools
pnpm gate
```

### Acceptance
- The three functions no longer call `db.transaction` or `tx.`.
- The tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
