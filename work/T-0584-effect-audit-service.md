---
id: T-0584
title: "Effect: audit/service.ts fully off drizzle and zod (entry + cursor schemas to Effect Schema, insert + list queries to effect/sql); same rows, same pagination, same error texts; tests unchanged"
status: todo
milestone: M5
branch: task/T-0584-effect-audit-service
model: auto
effort: low
depends_on: [T-0583]
estimate: 0.5 day
---

# T-0584: the audit service on effect/sql and Effect Schema

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle, and Effect Schema replaces zod. `apps/server/src/audit/service.ts` (399 lines) uses both, and **no caller passes it a transaction**. So the whole file moves in one task.

### Verified facts (do not re-derive)
- **Imports:** `drizzle-orm` (line 2), `zod` (3), and the tables from `../db/schema` (6-15).
- **`entrySchema` (36-54):**
  - a strict object;
  - `actorUserId`, `aiId`, `groupId` and `subjectId` are each a nullable string of 1 to 128 characters;
  - `action` matches `ACTION_PATTERN` (19), at most 100 characters;
  - `argsHash` is a nullable string matching `ARGS_HASH_PATTERN` (from `@zilar/protocol`);
  - `costCurrency` is `'EUR' | 'USD'` or null;
  - `costAmount` is a finite number ≥ 0, or null;
  - `result` is `'ok' | 'denied' | 'error'`;
  - `detail` is a nullable record (keys 1 to 64 characters, `unknown` values) with a refine: **"detail must serialise to at most 2048 bytes"** (it uses `MAX_DETAIL_BYTES`).
  
  `type AuditEntry = z.infer<...>` (56) is imported by `actions/gateway.ts`, `approvals/sweeper.ts` and several tests. Keep the same TS shape (readonly differences must not break those callers).
- **`recordAudit` (106-125):** decode; on failure throw `` `Invalid audit entry: ${first issue message ?? 'unknown'}` ``; then insert one row into `audit_log`, with:
  - `id` = `randomId()`;
  - `at` = `now`;
  - `cost_amount` as `costAmount.toFixed(2)` (a `numeric(12,2)` column);
  - `detail` as jsonb.
- **`audit/service.test.ts`:**
  - asserts `/Invalid audit entry/` (lines 138-184);
  - **asserts `/detail must serialise to at most 2048 bytes/` (161).** Effect 4.0.2 drops `{ message }` on length checks (the guide's "Schema, custom messages"), so use `makeFilter`, and prove that this exact text reaches the thrown message.
- **`cursorSchema` (130-134):** a string of 1 to 80 characters matching `/^[0-9a-zA-Z_:.\\-]+$/`. On failure, `parseCursor` throws `Error('Invalid cursor')`.
- **The queries:**
  - `listAuditForAi` (236): `SELECT owner FROM ais WHERE id = $1 LIMIT 1`;
  - `listForColumn` (246-272): `WHERE <group_id|ai_id> = $1 [AND (at < $at OR (at = $at AND id < $id))] ORDER BY at DESC, id DESC LIMIT limit+1`. The column comes from a closed choice, so **never interpolate an untrusted column name**: use two fixed fragments or `sql('group_id')` from a closed union;
  - `isGroupAdmin` (299-313): `group_members` inner join `groups` on `groups.id = $groupId`, where `group_id = $1 AND user_id = $2 LIMIT 1`; the role is owner or admin;
  - `filterHiddenTopicEntries` (318-369):
    - `SELECT * FROM topics WHERE id IN (...)`, of which only `id` and `visibility` are used: select just those;
    - `topic_members` by `topic_id IN (...)` and `user_id`;
    - `topic_role_access` join `group_member_roles` on `role_id`, by `topic_id IN (...)` and `user_id`.
- **`toPublicAuditEntry` (277-297)** maps a row:
  - `at` must stay a `Date` (timestamptz is returned as `Date`);
  - `costAmount` is read as `Number(...)` (numeric comes back as a string);
  - `detail` is read as an object or null.
  
  **Use an explicit row type with camelCase aliases** (`actor_user_id AS "actorUserId"` and so on), or map the snake_case columns.
- **The sql runtime:** use a local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)`, as in `apps/server/src/agents/gateway/db.ts`. **jsonb is written as `${JSON.stringify(detail)}::jsonb`**, or `NULL` when null.
- **Callers (unchanged):** `createAuditRecorder` (85), `recordAudit` from `groups/service.ts:680` and `806` (both pass the top-level `db`, outside the transaction), and `audit/api.ts` and `index.ts`.
- **Tests (all unchanged):**
  - `apps/server/src/audit/*.test.ts`;
  - `apps/server/src/groups/*.test.ts`;
  - `apps/server/src/actions/*.test.ts`;
  - `apps/server/src/approvals/*.test.ts`.

### What to build
1. **`audit/service.ts`:** zod becomes Effect Schema (the entry and the cursor), and drizzle becomes effect/sql (the insert and every select). Every export, signature, result, error text, order and pagination cursor stays the same. When done, the file has no `drizzle-orm`, no `zod` and no `db/schema` value import.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section, "Schema, custom messages" and "Effect 4 facts"), `apps/server/src/audit/service.ts` (all of it), `apps/server/src/agents/gateway/db.ts` and `apps/server/src/audit/service.test.ts`.

### Allowed files
`apps/server/src/audit/service.ts`, `work/T-0584-effect-audit-service.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot audit groups actions approvals
pnpm gate
```

### Acceptance
- The audit service runs on effect/sql and Effect Schema, with the same rows, pagination and error texts.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
