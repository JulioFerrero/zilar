---
id: T-0635
title: "effect/sql: agents/memory/store.ts off drizzle except deleteRoomMemory (groups/service.ts calls it inside its drizzle transaction); reads, addFact under its advisory lock, clearMemory in one transaction, putNode ON CONFLICT DO NOTHING; same output lines; tests unchanged"
status: merged
milestone: M5
branch: task/T-0635-effect-sql-memory-store
model: auto
effort: low
depends_on: [T-0596]
estimate: 1 day
---

# T-0635: the AI memory store on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. This is the store half of F3 in the T-0626 last-mile audit. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 130-230: a private `runSql`, `sql.withTransaction` and a raw advisory lock).

### Verified facts (do not re-derive; read the whole file, 600 lines)
- **`apps/server/src/agents/memory/store.ts`:** drizzle imports at 8 and 10.
- **`deleteRoomMemory` (522-567) stays on drizzle.** `apps/server/src/groups/service.ts:1114` calls it with a drizzle transaction. Leave it, its four deletes and both callers untouched, with a comment saying it moves when `removeGroupAi`'s transaction moves. `topics/service.ts:924` also calls it, with the top-level db.
- **Move these to effect/sql:**
  - `readFloor` (82-89): `floor_seq`, an integer;
  - `readTotal` (91-98): `max(seq)`; keep `Number(…) + 1` and 0 when null;
  - `loadRows` (143-161): `seq >= lo AND seq < hi ORDER BY seq`;
  - `loadSingle` (163-181) and `loadNodeMap` (183-193);
  - `recallMemory` (264-306): every word is an `ILIKE … ESCAPE '\'` with `escapeLike` (bound parameters, never built SQL), plus `deleted = false` and `seq >= floor`. The count uses `count(*)::int`. Then the newest `MEMORY_RECALL_MAX` by `seq DESC`, reversed;
  - `listFacts` (339-349): ordered by `created_at, id`;
  - **`addFact`** (357-412): **one transaction**:
    - `pg_advisory_xact_lock(hashtext('ai-memory-facts:' || aiId || ':' || chatKey))`;
    - a case-insensitive duplicate check (`lower(text) = lower($1)`);
    - an insert;
    - then the oldest facts past `MEMORY_FACTS_MAX` are deleted. Use `sql.in`, guarded: the list is non-empty only when `excess > 0`;
  - `deleteFact` (416-433): `DELETE … RETURNING`; true when a row went;
  - `putNode` (483-502): insert with `ON CONFLICT DO NOTHING` (the primary key is `(ai_id, chat_key, lo, hi)`);
  - **`clearMemory`** (572-599): **one transaction**: `max(seq)`, delete the nodes, delete the facts, then upsert `ai_memory_state` with `ON CONFLICT (ai_id, chat_key) DO UPDATE SET floor_seq, updated_at`. The insert sets only `ai_id, chat_key, floor_seq`; `indexed_through_micros` defaults to 0.
- **Rows:**
  - `formatRow` (64-66) calls `row.at.toISOString()`, so `at` (timestamptz) must reach it as a `Date`. Check what effect/sql returns, as other converted modules do;
  - `seq`, `lo`, `hi` and `floor_seq` are integers;
  - this file never reads the bigint `indexed_through_micros`.
- **The other modules' calls stay as they are:** `agents/gateway/memory.ts:5`, `agents/gateway/tool-exec.ts:5`, `agents/memory/api.ts:39` and `agents/memory/compactor.ts:9`. Keep every exported signature.
- **Tests that must pass unchanged:**
  - `apps/server/src/agents/memory/*.test.ts`;
  - `apps/server/src/agents/gateway/*.test.ts`;
  - `apps/server/src/groups/*.test.ts`;
  - `apps/server/src/topics/*.test.ts`.

### What to build
1. Move every function listed under "Move these" to effect/sql, with the same queries, locks, transactions and output lines. The drizzle imports stay only for `deleteRoomMemory`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 130-230), `apps/server/src/agents/memory/store.ts`.

### Allowed files
`apps/server/src/agents/memory/store.ts`, `work/T-0635-effect-sql-memory-store.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/memory src/agents/gateway src/groups src/topics
pnpm gate
```

### Acceptance
- The memory store runs on effect/sql, except the one function that waits for its caller's transaction.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done. Every function listed in the spec now runs on `effect/sql`; `deleteRoomMemory` stays on drizzle.

**What changed** — only `apps/server/src/agents/memory/store.ts`
- Imports: added `Effect` (`effect`), `SqlClient`, `SqlError`, `type Statement` (`effect/sql`) and `sqlRuntimeFor`; trimmed the drizzle import to `and, eq, sql` (only `deleteRoomMemory` still uses it). Added a private `runSql(db, effect)` that runs each effect through `sqlRuntimeFor(db).runPromise`, matching `pins/service.ts`.
- Converted to raw tagged-template SQL with bound parameters: `readFloor` (`floor_seq`), `readTotal` (`max(seq) AS max_seq`, still `Number(...) + 1`, 0 when null), `loadRows`, `loadSingle`, `loadNodeMap`, `listFacts`, `deleteFact`, `putNode`, `clearMemory`.
- `recallMemory`: conditions are a `Statement.Fragment[]` (`ai_id = $1`, `chat_key = $2`, `deleted = false`, `seq >= floor`, then one `text ILIKE $n ESCAPE '\'` per word via `escapeLike`), combined with `sql.and`; the count uses `count(*)::int AS count`; the newest `MEMORY_RECALL_MAX` by `seq DESC` are reversed, then the same `Newest 30 of N matches.` note.
- `addFact`: one `sql.withTransaction` — the raw `pg_advisory_xact_lock(hashtext('ai-memory-facts:' || aiId || ':' || chatKey))`, the case-insensitive `lower(text) = lower($1)` duplicate check, the insert, then the oldest rows past `MEMORY_FACTS_MAX` deleted with `id IN ${sql.in(oldest)}` guarded by `excess > 0`.
- `putNode`: `INSERT ... ON CONFLICT DO NOTHING`.
- `clearMemory`: one `sql.withTransaction` — `max(seq)`, delete nodes, delete facts, upsert `ai_memory_state` with `ON CONFLICT (ai_id, chat_key) DO UPDATE SET floor_seq = $1, updated_at = $2`; the insert sets only `ai_id, chat_key, floor_seq` (`indexed_through_micros` defaults to 0).
- `deleteRoomMemory` is untouched (four deletes and the table references byte-identical) apart from the comment the spec asked for: it moves when `removeGroupAi`'s transaction moves.
- Rows: `timestamptz` reaches `formatRow` as a `Date`; `seq`/`lo`/`hi`/`floor_seq` come back as numbers. `effect/sql` returns `ReadonlyArray`, so `loadRows` and `listFacts` copy with `[...rows]` and `recallMemory` uses `[...rows].reverse()`.

**Not changed:** every exported signature; `memoryRange`, `renderMemoryBlock`, `zoomMemory`, `pendingNodes`, `compactionInput`, `buildCompactionPrompt`; all test files. No new dependencies.

**Commands run (real results)**
- `pnpm install` — done (1173 packages added/reused).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/memory/store.test.ts` — 1 file, 24 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/memory src/agents/gateway src/groups src/topics` — 12 files, 353 passed, 0 failed (118.4s).
- `pnpm gate` — first run FAILED (format on `store.ts`, then `TS4104`/`TS2339` readonly-array errors); after fixing and re-running:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (15.7s)
  PASS  lint  (0.7s)
  PASS  typecheck  (9.5s)
  PASS  tests @zilar/server  (6.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

**Tests:** unchanged, all green.

**Problems / deviations:** none.

**Open questions:** none.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no findings. The packet head is c881f8ba, the current HEAD.
- **Lead check:**
  - `addFact` keeps its advisory lock, duplicate check, insert and capped trim in one transaction, with a guarded `sql.in`;
  - `clearMemory` runs in one transaction;
  - recall keeps bound `ILIKE ... ESCAPE` per word and `count(*)::int`;
  - `deleteRoomMemory` is untouched on drizzle, with its comment.
