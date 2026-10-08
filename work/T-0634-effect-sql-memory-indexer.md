---
id: T-0634
title: "effect/sql: agents/memory/indexer.ts off drizzle; the per-chat transaction (advisory lock, cursor read with bigint kept through BigInt, max seq, correction and retraction rewrites with covering-node drops, ON CONFLICT DO NOTHING inserts with dense seqs, cursor upsert) in one sql.withTransaction; tests unchanged"
status: todo
milestone: M5
branch: task/T-0634-effect-sql-memory-indexer
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0634: the AI memory indexer on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. This is the indexer half of F3 in the T-0626 last-mile audit. `agents/memory/store.ts` is a separate task, because its `deleteRoomMemory` runs inside the `groups/service.ts` drizzle transaction. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 130-230: `sql.withTransaction` and a raw advisory lock).

**The bigint rule:** an effect/sql read of a `bigint` column comes back as a **string**, so wrap it in `BigInt(...)` or `Number(...)` before any math or comparison.

### Verified facts (do not re-derive; read the whole file, 327 lines)
- **`apps/server/src/agents/memory/indexer.ts`:** drizzle imports at 6 (`and, eq, gt, lte, sql`) and 9. `MemoryTransaction` (156) is a drizzle type.
- **`indexMemory`** (198-327) is called once, with the top-level `deps.db`, at `apps/server/src/agents/gateway/memory.ts:60`. Keep its signature and its result `{ read, inserted, done }`.
- **Everything runs in ONE transaction** (209-324). Keep it as one `sql.withTransaction`:
  1. `pg_advisory_xact_lock(hashtext(aiId || '|' || chatKey))` (210);
  2. the cursor `ai_memory_state.indexed_through_micros`, a **bigint**, read through `BigInt(stored)` (212-218). Keep `BigInt` before the comparison at 220;
  3. the archive read (228) is not drizzle; leave it alone;
  4. `max(seq)` for the chat (232-236); keep `Number(… ?? -1) + 1`;
  5. per row:
     - a correction updates `text` and drops covering nodes (245-262);
     - a retraction sets `deleted = true, text = ''` and drops covering nodes (265-282);
     - otherwise insert (290-307) with `ON CONFLICT (ai_id, chat_key, message_id) DO NOTHING RETURNING`. **`nextSeq` and `inserted` advance only when a row was really inserted**, so seqs stay dense;
  6. upsert the cursor (314-323): `ON CONFLICT (ai_id, chat_key) DO UPDATE`.
- **The helpers** `targetSeq` (158-176) and `dropCoveringNodes` (180-196: `lo <= seq AND hi > seq`) run inside that transaction. Make them take the effect/sql client or return Effects.
- **Columns:** `seq` is an integer and `at` is a timestamptz (`apps/server/src/db/schema.ts`, `aiMemoryMessages`). The primary key is `(ai_id, chat_key, seq)` and the unique index is `(ai_id, chat_key, message_id)`.
- **Tests that must pass unchanged:**
  - `apps/server/src/agents/memory/indexer.test.ts`;
  - `apps/server/src/agents/memory/compactor.test.ts`;
  - `apps/server/src/agents/memory/store.test.ts`;
  - `apps/server/src/agents/gateway/*.test.ts`.

### What to build
1. Move the transaction and the two helpers to effect/sql, with the same steps, order, counts and dense seqs. The file keeps no value import from `drizzle-orm` or `db/schema`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 130-230), `apps/server/src/agents/memory/indexer.ts`.

### Allowed files
`apps/server/src/agents/memory/indexer.ts`, `work/T-0634-effect-sql-memory-indexer.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/memory src/agents/gateway
pnpm gate
```

### Acceptance
- The memory indexer runs on effect/sql, with one locked transaction per pass and dense seqs.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
