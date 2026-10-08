---
id: T-0568
title: "effect/sql: agents/delegation/service.ts (check, create, get, finish, cancel) drops drizzle for effect/sql through sqlRuntimeFor; same signatures, caps, reasons and single conditional updates; tests unchanged"
status: merged
milestone: M5
branch: task/T-0568-effect-sql-delegation
model: auto
effort: low
depends_on: [T-0556]
estimate: 0.5 day
---

# T-0568: AI delegation service on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server service onto effect/sql". The closest example is `apps/server/src/ais/usage.ts` (T-0548): a local `runSql(db, effect)` helper over `sqlRuntimeFor(db).runPromise`, at lines 34-39.

### Verified facts (do not re-derive)
- **`apps/server/src/agents/delegation/service.ts`** (269 lines) imports drizzle (line 9) and the tables `aiDelegations`, `ais`, `groupAis`, `topicAis` and `topics` (line 11). Its functions:
  - **`bothInRoom`** (private, line 101):
    - with a `topicId`, it reads the topic's `isGeneral` and `groupId`. A missing topic, or a topic in another group, gives `false`. A non-General topic needs **both** AIs in `topic_ais` (`rows.length === 2`);
    - otherwise, and for a General topic, it needs both AIs in `group_ais` for the group.
  - **`checkDelegation`** (128). The order matters:
    1. `same_ai`;
    2. read `id, can_delegate, accepts_delegation, status` from `ais` for both ids; a missing one is `inactive`;
    3. `cannot_delegate`;
    4. `not_accepting`;
    5. either one not `active` is `inactive`;
    6. `not_in_room`.
  - **`createDelegation`** (157):
    1. the check;
    2. `objective` trimmed and cut to `OBJECTIVE_MAX`, and empty is `empty_objective`;
    3. `randomUUID()`;
    4. budget columns only when `budget.max >= 0`, with `budget_max = max.toFixed(2)` (a `numeric` column);
    5. an insert with `capOptional` and `capList` applied;
    6. it returns `{ ok: true, delegation: { id, toAiId, objective, status: 'working' } }`.
  - **`getDelegationForAi`** (192) reads `id, fromAiId, toAiId, status, objective, resultSummary, artifacts, updatedAt` where `id = $1 AND (from_ai_id = $2 OR to_ai_id = $2)`, `LIMIT 1`. It returns the row or `null`.
  - **`finishDelegation`** (221) is a single conditional `UPDATE … WHERE id AND to_ai_id AND status = 'working'`:
    - it sets `status`, `result_summary` and `updated_at = new Date()`, and sets `artifacts` **only when `input.artifacts` is defined**;
    - it returns `true` when a row was updated.
  - **`cancelDelegation`** (253) is the same with `from_ai_id`. It sets `status = 'canceled'` and `updated_at`.
- **Table `ai_delegations`** (`apps/server/src/db/schema.ts:612`). The columns are snake_case:
  - `acceptance`, `constraints` and `artifacts` are **`jsonb` string arrays**. Write them as `${JSON.stringify(list)}::jsonb`; the driver parses jsonb back to arrays on read;
  - `budget_max` is `numeric(12,2)`;
  - `updated_at` is `timestamptz`. **`DelegationView.updatedAt` must stay a `Date`**: check how an existing effect/sql module (`apps/server/src/pins/service.ts`) returns timestamps, and convert if the driver gives a string.
  
  The `ais` columns are `can_delegate`, `accepts_delegation` and `status`. Rows come back camelCased through `transformResultNames` (`apps/server/src/effect/sql.ts`).
- **Callers, which stay unchanged:**
  - `apps/server/src/agents/gateway/group-turn.ts:186,491` (`finishDelegation`);
  - `apps/server/src/agents/gateway/tool-exec.ts:176,249` (`createDelegation`, `getDelegationForAi`).
  
  They all pass `deps.db`; there is no transaction.
- **Tests (all unchanged):**
  - `apps/server/src/agents/delegation/service.test.ts` (it uses `createTestContext`, which registers the runtime);
  - `apps/server/src/agents/gateway.test.ts`;
  - `apps/server/src/agents/tools.test.ts`.

### What to build
1. **Rewrite the service with effect/sql:**
   - keep every exported name, constant, type and signature;
   - keep the same reason order, caps and returned values;
   - keep the same single conditional updates (`RETURNING id` is enough to count rows);
   - add a local `runSql` like `ais/usage.ts:34-39`;
   - leave no `drizzle-orm` import and no `../../db/schema` import.
2. **Row typing:** give each query an explicit row interface.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/ais/usage.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/effect/sql.ts`, `apps/server/src/agents/delegation/service.ts` (all of it) and `apps/server/src/agents/delegation/service.test.ts`.

### Allowed files
`apps/server/src/agents/delegation/service.ts`, `work/T-0568-effect-sql-delegation.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/delegation agents/gateway agents/tools
pnpm gate
```

### Acceptance
- The delegation service runs on effect/sql with the same behaviour and no drizzle.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Rewrote `apps/server/src/agents/delegation/service.ts` on `effect/sql`, following `apps/server/src/ais/usage.ts` (local `runSql(db, effect)` over `sqlRuntimeFor(db).runPromise`).
- Removed both `drizzle-orm` and `../../db/schema` imports. Every exported name, constant, type and signature is unchanged; every caller is untouched.
- Kept the reason order, the caps (`capList` / `capOptional` unchanged) and the returned values. Row shapes are explicit interfaces (`TopicRow`, `AiIdRow`, `AiCheckRow`, `DelegationRow`).
- `bothInRoom`: reads `is_general, group_id` for a set topic, then membership in `topic_ais` or `group_ais` with `sql.in([fromAiId, toAiId])` and `rows.length === 2`, exactly as the drizzle `inArray` did.
- `checkDelegation`: one `SELECT id, can_delegate, accepts_delegation, status FROM ais WHERE id IN (...)` and the same order of checks.
- `createDelegation`: one `INSERT` with the same columns. `acceptance`/`constraints`/`artifacts` are written as `${JSON.stringify(list)}::jsonb` per the spec; budget columns are `null` unless `budget.max >= 0`, with `budget_max = max.toFixed(2)`.
- `getDelegationForAi`: single `SELECT ... LIMIT 1` with `id = $1 AND (from_ai_id = $2 OR to_ai_id = $2)`.
- `finishDelegation` / `cancelDelegation`: one conditional `UPDATE ... WHERE ... AND status = 'working' RETURNING id`, returning `updated.length > 0`. `finishDelegation` sets `artifacts` only when `input.artifacts` is defined, via an interpolated `sql` fragment.
- `updated_at` is set from `new Date().toISOString()`, the pattern used by `contact-requests/service.ts`. On read, `DelegationView.updatedAt` stays a `Date`: like `pins/service.ts` (`pinnedAt.toISOString()`) and `contact-requests/service.ts` (`createdAt.toISOString()`), the driver returns `timestamptz` as a `Date`, so no conversion was needed.

### Files changed
- `apps/server/src/agents/delegation/service.ts` (the conversion).
- `work/T-0568-effect-sql-delegation.md` (status + this Report).

No test file was changed; no other file was touched.

### Commands and real results
- `pnpm install` — done, exit 0 (only a pre-existing peer-dependency warning).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/delegation/service.test.ts` — 1 file passed, 20 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway.test.ts agents/tools.test.ts` — 2 files passed, 216 tests passed.
- `pnpm gate` from the repo root — summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (6.0s)
  PASS  format  (115.0s)
  PASS  lint  (1.8s)
  PASS  typecheck  (44.9s)
  PASS  tests @zilar/server  (127.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations / open questions
- None. All listed tests pass unchanged; no new dependency; no security-relevant surface (the JSON columns hold caller-supplied task text, unchanged from the drizzle version, and the queries keep the same scoping by `from_ai_id` / `to_ai_id`).

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 0 findings. The packet (07:22) is newer than HEAD 574a5d34.
- **Only `delegation/service.ts` changed;** no test file changed.
- **Lead check:** the lead read every statement against the drizzle version.
  - The reason order is the same.
  - `bothInRoom` has the same topic and group branches with `IN (from, to)` and a count of 2.
  - The INSERT has the same columns, with jsonb lists through `::jsonb` and the budget null when unset (the column default).
  - finish and cancel are the same single conditional UPDATEs with `RETURNING id`, and `artifacts` is set only when given.
- **Tests:** 236 passed at the worker.
