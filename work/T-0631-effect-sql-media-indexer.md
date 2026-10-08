---
id: T-0631
title: "effect/sql: media/indexer.ts off drizzle; the cursor read (bigint as string, keep BigInt), and the per-chat transaction (link delete, retraction update, ON CONFLICT DO NOTHING inserts with an exact inserted count, cursor upsert, cap prune) in one sql.withTransaction; tests unchanged"
status: merged
milestone: M5
branch: task/T-0631-effect-sql-media-indexer
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0631: the media indexer on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. This is F5 in the T-0626 last-mile audit, which is not merged yet. Its bigint rule: any effect/sql read of a `bigint` column comes back as a string, so wrap it in `BigInt(...)` or `Number(...)` before any math, comparison or JSON. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql` and `sql.withTransaction`).

### Verified facts (do not re-derive; read lines 215-411)
- **`apps/server/src/media/indexer.ts`:**
  - drizzle imports at 2 (`and, eq, sql`) and 5 (`mediaIndexState, mediaItems`);
  - `MediaItemInsert` (220) and `MediaTransaction` (221) are drizzle types.
- **`indexChat`** (308-411) is called with the top-level db at `apps/server/src/files/api.ts:243` and `apps/server/src/media/api.ts:327`. Keep its signature and its result `{ read, inserted, done }`.
- **The cursor read** (313-321) gets `media_index_state.indexed_through_micros`, a **bigint** column (`apps/server/src/db/schema.ts:1443`). effect/sql returns it as a string. The code already passes it through `BigInt(stored)` (321), which accepts a string; keep it that way, and never do math on it before `BigInt`.
- **The transaction** (331-408) must stay **one** transaction (`sql.withTransaction`). It does these steps in order:
  1. for a correction, delete the target's `link` rows (342-351), then insert the new links;
  2. for a retraction, `UPDATE media_items SET deleted = true` for the target message (365-374);
  3. otherwise insert the extracted items (380-383) through `insertItems` (258-276). That is `ON CONFLICT (archive_owner, chat_jid, message_id, kind, ref) DO NOTHING` (the unique index at `schema.ts:1419-1426`) with `RETURNING`. **`inserted` must count only the rows actually inserted**, as today;
  4. upsert the cursor (389-395): `ON CONFLICT (archive_owner, chat_jid) DO UPDATE`, with `indexed_through_micros` from `Number(lastMicros)`, as today;
  5. the cap prune (400-407): already raw SQL; keep it as is.
- **The `media_items` columns** to write are those in `toInsert` (234-256). `at_micros` is bigint (pass the number); `waveform` is **jsonb** (`${JSON.stringify(x)}::jsonb`, or NULL); `size`, `width`, `height` and `duration_ms` are integers.
- **`buildIndexQuery`** (281-302) and the archive read (326) are not drizzle; leave them alone.
- **Tests that must pass unchanged:** `apps/server/src/media/indexer.test.ts`, `apps/server/src/media/routes.test.ts` and `apps/server/src/files/routes.test.ts`.

### What to build
1. Move the cursor read and the whole transaction to effect/sql, with the same steps, order and counts. Replace the two drizzle types with local ones. The file keeps no value import from `drizzle-orm` or `db/schema`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/media/indexer.ts`.

### Allowed files
`apps/server/src/media/indexer.ts`, `work/T-0631-effect-sql-media-indexer.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/media src/files
pnpm gate
```

### Acceptance
- The indexer runs on effect/sql, with one transaction per chat batch and exact inserted counts.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** review

### What I did
- Moved `indexChat`'s cursor read and its single per-chat transaction onto `effect/sql` in `apps/server/src/media/indexer.ts`; dropped the `drizzle-orm` and `db/schema` value imports (the file now imports `Effect`, `SqlClient`/`SqlError` and `sqlRuntimeFor`).
- The cursor read is `` SELECT indexed_through_micros FROM media_index_state ... `` typed as `{ indexedThroughMicros: string }`, then wrapped in `BigInt(stored)` as before (no math before the `BigInt`).
- Replaced the drizzle `MediaItemInsert` / `MediaTransaction` types with a local `MediaItemRow` interface and a private `runSql(db, effect)` helper (same shape as `pins/service.ts`).
- The whole transaction is one `sql.withTransaction`, in the same order: link delete for a correction, `deleted = true` update for a retraction, `insertItems` with `ON CONFLICT (archive_owner, chat_jid, message_id, kind, ref) DO NOTHING ... RETURNING id` counting only inserted rows, the cursor upsert `ON CONFLICT (archive_owner, chat_jid) DO UPDATE` with `Number(lastMicros)`, then the raw cap-prune `DELETE`. `waveform` is written as `${JSON.stringify(x)}::jsonb` (NULL when absent); `at_micros` binds the number.
- `buildIndexQuery` and the archive read are untouched; `indexChat`'s signature and `{ read, inserted, done }` result are unchanged.
- No test files changed.

### Files changed
- `apps/server/src/media/indexer.ts`
- `work/T-0631-effect-sql-media-indexer.md`

### Commands run
- `pnpm install` — Done (13.3s), only the pre-existing `@types/react-dom` peer warning.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/media/indexer.test.ts` — 1 file passed, 15 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/media src/files` — 3 files passed, 39 tests passed.
- `pnpm gate` — summary:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (18.7s)
  PASS  lint  (1.0s)
  PASS  typecheck  (9.8s)
  PASS  tests @zilar/server  (9.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes / deviations
- None. `MediaItemRow` is the local replacement for the drizzle insert type; the helper `insertItems` now builds one multi-row `INSERT` with the same conflict target and counts `RETURNING id`.
- The added `runSql` allows a `SqlError.SqlError` error channel; the exported `indexChat` still returns a Promise and propagates the error unchanged, as before.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no findings. The packet head is d597f8d9, the current HEAD.
- **Lead check:**
  - one `sql.withTransaction`, in the same order;
  - the cursor bigint goes through `BigInt(stored)` before any comparison;
  - the insert keeps `ON CONFLICT DO NOTHING RETURNING id`, so the inserted count is exact;
  - `waveform` is written as `::jsonb` or NULL;
  - the cursor upsert is inside the transaction.
