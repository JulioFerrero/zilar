---
id: T-0671
title: "effect/sql: move the ais/service.ts reads listAis, listActiveAisForGateway and findOwnedAi onto effect/sql (copy findGatewayAiEffect), fix the module header comment, and type decryptForGatewayUseEffect's error as SqlError | Error"
status: merged
milestone: M5
branch: task/T-0671-ais-reads-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0671: ais reads on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. After T-0660, `ais/service.ts` still reads through drizzle in three exported functions. T-0660's pre-review also left two nits, folded in here.

### Verified facts (do not re-derive)
- **`apps/server/src/ais/service.ts`:**
  - `listAis(db, ownerId)` (line 125) selects `publicAiColumns` (line 1193) from `ais` inner join `ai_limits` where `owner = ownerId`, ordered by `ais.created_at` ascending, then maps with `toPublicAi`;
  - `listActiveAisForGateway(db)` (line 146) selects `id, jid, localpart, owner, name, persona` from `ais` where `status = 'active'`, ordered by `created_at` ascending;
  - `findOwnedAi(db, id, ownerId)` (line 195) selects `aiColumns` (`publicAiColumns` plus `ais.localpart`, `llm_virtual_keys.litellm_key_id` and `litellm_model_id`) from `ais`, inner join `ai_limits`, left join `llm_virtual_keys`, where `ais.id = id AND ais.owner = ownerId LIMIT 1`, and returns the row or null.
  - Every caller passes a plain db (`deps.db` or `db`), never a transaction: `ais/api.ts:414`, `chats/api.ts:106`, `agents/gateway/lifecycle.ts:57`, `groups/service.ts:952`, and `ais/service.ts` itself.
- **The model to copy:** `findGatewayAiEffect` (`ais/service.ts:869`) selects the same columns on effect/sql, names each one as `ais.<col>`, `ai_limits.<col>` or `llm_virtual_keys.<col>`, and relies on the client's snake-to-camel result names (`apps/server/src/effect/sql.ts:37`). `runSql` is at `ais/service.ts:27`. `per_day_usd` and `per_month_usd` come back as strings either way; `toPublicAi` already applies `Number(...)`.
- **The header comment** at `ais/service.ts:23-26` says only "three chat-driven persona/limit writes" run on effect/sql, which is now wrong.
- **`apps/server/src/connections/service.ts:153` `decryptForGatewayUseEffect`** returns `Effect.Effect<string, unknown, SqlClient.SqlClient>`. Its decrypt is `Effect.try({ try: () => cipher.decrypt(…), catch: (error) => error })`.
- **Tests:** `apps/server/src/ais/*.test.ts` and `apps/server/src/connections/*.test.ts`.

### What to build
1. **Rewrite `listAis`, `listActiveAisForGateway` and `findOwnedAi`** with `runSql` and one `sql<Row>` statement each: the same columns, joins, filters and order. Keep their signatures and return shapes, and make sure `createdAt` is still a `Date`.
2. **Rewrite the header comment** at lines 23-26 to say which parts are on effect/sql and which still use drizzle (`createAi`, `stopAi`, `resumeAi`, `assignMachine`, `findUserName`, `compensateCreate`, `withAiEnsureLock`).
3. **`decryptForGatewayUseEffect`:** type the error as `SqlError.SqlError | Error`, and map a non-Error decrypt throw to `new Error(String(error))`, keeping the original object when it is an `Error`.
4. **Remove** drizzle imports that become unused.

### Read first
`AGENTS.md`, `apps/server/src/ais/service.ts` (lines 1-235, 860-905 and 1175-1240), `apps/server/src/connections/service.ts` (lines 140-185).

### Allowed files
`apps/server/src/ais/service.ts`, `apps/server/src/connections/service.ts`, `work/T-0671-ais-reads-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais src/connections
pnpm gate
```

### Acceptance
- The three reads have no drizzle.
- The ais and connections tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/ais/service.ts`:
  - Rewrote `listAis`, `listActiveAisForGateway` and `findOwnedAi` with `runSql` and one `sql<Row>` statement each, keeping the same columns, joins, filters and `created_at` ascending order. `listAis` selects the public columns and maps through `toPublicAi`; `findOwnedAi` selects `AiRecord` (public columns plus `localpart`, `litellm_key_id`, `litellm_model_id`) and returns the row or `null`; `listActiveAisForGateway` returns the `ActiveAiForGateway` columns.
  - Removed the now-unused `publicAiColumns` and `aiColumns` drizzle constants and the unused `asc` import (`and`/`eq` are still used elsewhere in the module).
  - Rewrote the module header comment: it now names the effect/sql parts (the four reads plus the three chat-driven persona/limit writes) and the still-drizzle writes (`createAi`, `stopAi`, `resumeAi`, `assignMachine`, `findUserName`, `compensateCreate`, `withAiEnsureLock`).
- `apps/server/src/connections/service.ts`: `decryptForGatewayUseEffect` now returns `Effect.Effect<string, SqlError.SqlError | Error, SqlClient.SqlClient>`, and its `Effect.try` catch maps a non-`Error` throw to `new Error(String(error))`, keeping the original object when it already is an `Error`.

### Files changed
- `apps/server/src/ais/service.ts`
- `apps/server/src/connections/service.ts`
- `work/T-0671-ais-reads-effect-sql.md` (status/report only)

### Commands and real results
- `pnpm install`: Done, 3 deprecated subdependencies, peer warning in `apps/mobile` (@types/react-dom vs @types/react). No new packages needed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais src/connections`: Test Files 7 passed | 2 skipped (9); Tests 127 passed | 3 skipped (130); duration 30.44s.
- `pnpm gate`: first run `GATE FAIL` on typecheck (TS4104: `readonly ActiveAiForGateway[]` not assignable to mutable), fixed, second run:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.5s)
  PASS  format  (71.9s)
  PASS  lint  (1.6s)
  PASS  typecheck  (5.7s)
  PASS  tests @zilar/server  (39.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- One type error on the first gate run: `effect/sql` returns `ReadonlyArray`, and `listActiveAisForGateway` returns a mutable array. Fixed by spreading the rows (`return [...rows]`). `listAis` was already fine because `.map` returns a mutable array. No deviation from the spec.

### Open questions
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean, with no nits; the packet head is 87096a5c.
- **Result:** the three ais reads are on effect/sql with the same columns, joins and order. The header comment names what is left on drizzle. `decryptForGatewayUseEffect` is typed `SqlError | Error`. This also covers both T-0660 nits.
