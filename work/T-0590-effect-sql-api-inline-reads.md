---
id: T-0590
title: "effect/sql: the inline drizzle reads in agents/memory/api.ts (AI owner lookup), media/api.ts (media page query) and auth/api.ts (handle + session user) move to effect/sql; bigint and timestamp-without-tz handled exactly as drizzle did; tests unchanged"
status: todo
milestone: M5
branch: task/T-0590-effect-sql-api-inline-reads
model: auto
effort: low
depends_on: [T-0584]
estimate: 0.5 day
---

# T-0590: the inline reads in three Effect API files

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. Three files that already serve on Effect HTTP still run inline drizzle selects, all on the top-level `db` with no transaction.

### Verified facts (do not re-derive)
1. **`apps/server/src/agents/memory/api.ts:84-88`:** `SELECT id, owner, jid FROM ais WHERE id = $1 LIMIT 1`. Imports: `eq` (line 8) and `ais` (22).
2. **`apps/server/src/media/api.ts:333-348`** (inside `Effect.promise`):
   - `SELECT * FROM media_items WHERE archive_owner = $1 AND chat_jid = $2 AND deleted = false AND kind IN (...kinds) [AND at_micros < $before] ORDER BY at_micros DESC, id ASC LIMIT limit+1`;
   - the rows feed `toMediaItem` and `senderNameFor` (`MediaItemRow`, the full row, camelCase; check its type);
   - **`at_micros` is `bigint` with `mode: 'number'`** (`db/schema.ts:1400`). The pg driver returns int8 as a **string**, so convert it to a number when mapping (the values fit in a double), or `next` and the order of the answer change;
   - `waveform` is jsonb (decoded);
   - `created_at` is timestamptz (a `Date`);
   - `kinds` is never empty here (check, and keep a guard if it can be).
   
   Imports: line 13 (drizzle) and 28 (`mediaItems`).
3. **`apps/server/src/auth/api.ts`:**
   - (386-390) `SELECT handle FROM handles WHERE user_id = $1 LIMIT 1`;
   - (414-425) `SELECT id, email, name, image, created_at FROM "user" WHERE id = $1 LIMIT 1` (**`user` is a reserved word, so quote it**). No row gives `HttpError(401, 'unauthorized', 'Authentication required')`.
   - **`user.created_at` is `timestamp` WITHOUT a time zone** (`auth/auth-schema.ts:10`). Drizzle reads it as UTC. The raw pg driver parses it in the **process's local** time zone, which shifts the ISO string the API returns. Read it as `(created_at AT TIME ZONE 'UTC') AS "createdAt"`, which returns a correct `Date`. Prove it in the Report by running the `/me` test once with `TZ=America/New_York`.
   
   Imports: lines 27-28.
- **The sql runtime:** a local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)`, as in `apps/server/src/agents/gateway/db.ts`. Inside an Effect handler you may `yield*` the sql effect provided by the runtime instead; pick one way per file and keep it simple.
- **When done:** the three files have no `drizzle-orm` or `db/schema` value import; type-only imports are fine.
- **Tests (all unchanged):**
  - `apps/server/src/agents/memory/*.test.ts`;
  - `apps/server/src/media/*.test.ts`;
  - `apps/server/src/auth/*.test.ts`;
  - the authz sweep (`authz-sweep`).

### What to build
1. Move the five reads to effect/sql with the same rows, order, nulls and errors.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/agents/gateway/db.ts`, and the three files around the lines above.

### Allowed files
`apps/server/src/agents/memory/api.ts`, `apps/server/src/media/api.ts`, `apps/server/src/auth/api.ts`, `work/T-0590-effect-sql-api-inline-reads.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/memory media auth authz-sweep
pnpm gate
```

### Acceptance
- The three files read through effect/sql with the same answers. `at_micros` stays a number, and `/me` `createdAt` is the same in any process time zone.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
