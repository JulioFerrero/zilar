---
id: T-0647
title: "effect/sql: tools/api.ts and tools/adapters.ts reads (F9); every drizzle select becomes an effect/sql statement or an existing topics/access.ts helper; no drizzle import left in either file; same tests"
status: merged
milestone: M5
branch: task/T-0647-tools-api-adapters-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0647: tools API and adapters reads on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. This is F9 in the T-0626 last-mile audit (`docs/audit/effect-last-mile.md`). Both files only **read** with drizzle. There is no transaction, and no caller passes in a drizzle `tx`.

### Verified facts (do not re-derive)
- **`apps/server/src/tools/adapters.ts`:**
  - imports `eq` (line 16), `ServerDatabase` (line 19) and `ais` (line 20);
  - its only query is `ownerOf(db, aiId)` (lines 136-142): `db.select({ owner: ais.owner }).from(ais).where(eq(ais.id, aiId)).limit(1)`, which throws if there is no row.
- **`apps/server/src/tools/api.ts`** imports `and, eq` (line 24) and `ais, aiTools, groupAis, groupMembers, topicAis, topics` (line 29). Its drizzle reads:
  - `select().from(topics)` by id: lines 324 and 366 (inside `Effect.promise`), and in `toolAccess` (line 802) and `toolAccessIncludingDeleted` (line 855);
  - `select().from(topics)` by `groupId`: `listToolsForGroup` (line 933);
  - `groupAis.aiId` by `groupId`: lines 377-380 and 942-945;
  - `topicAis.aiId` by `topicId`: lines 383-386 and 946-949;
  - `ais.owner` by id: lines 789-793 and 848;
  - the five `aiTools` columns by id: `toolAccessIncludingDeleted`, lines 832-844;
  - `findOwnedAiRow` (lines 963-970) and `findMembership` (lines 972-979).
- **Helpers in `apps/server/src/topics/access.ts`:**
  - `getTopic(db, topicId): Promise<TopicRow | null>` (line 95) already runs `SELECT * FROM topics` on effect/sql;
  - `canSeeTopic(db, topic: TopicRow, userId)` (line 144) takes that row type.
- **The recipe already used in `apps/server/src/actions/production-announcer.ts:46-51`:**
  - a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise(effect)`;
  - statements are written as `` sql<Row>`SELECT ... WHERE id = ${id} LIMIT 1` ``;
  - result names come back camelCased (`topics/access.ts:100` relies on this for `TopicRow`).

### What to build
1. **`adapters.ts`:** `ownerOf` runs `SELECT owner FROM ais WHERE id = ${aiId} LIMIT 1` through a private `runSql`. It keeps the same throw. Drop the three drizzle and schema imports.
2. **`api.ts`:**
   - every topic-by-id read calls `getTopic(db, id)` (import it from `../topics/access`). `const [topic] = …` becomes `const topic = …`, and the following `!topic` checks stay.
   - `listToolsForGroup` reads its topics with `` sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}` ``.
   - The other reads become effect/sql statements that select the same columns, through one private `runSql`. Inside the `Effect.gen` handlers they may stay wrapped in `Effect.promise(() => runSql(...))`.
   - Drop the `drizzle-orm` import and the `../db/schema` value import. A type-only schema import is fine.
3. **Keep every function signature, return shape, status, message and the order of checks.** Change no test.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/actions/production-announcer.ts` (lines 1-60), `apps/server/src/topics/access.ts` (lines 25-160), `apps/server/src/tools/adapters.ts` (lines 1-30 and 130-145), `apps/server/src/tools/api.ts` (lines 1-50, 300-400 and 780-985).

### Allowed files
`apps/server/src/tools/api.ts`, `apps/server/src/tools/adapters.ts`, `work/T-0647-tools-api-adapters-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/routes src/tools/adapters
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm" apps/server/src/tools/api.ts apps/server/src/tools/adapters.ts` shows nothing.
- The tools tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Moved every drizzle read in `apps/server/src/tools/adapters.ts` and `apps/server/src/tools/api.ts` onto `effect/sql`, following the recipe in `apps/server/src/actions/production-announcer.ts:46-51`. Signatures, return shapes, statuses, messages and the order of checks are unchanged; no test or schema file was touched.

**`adapters.ts`**
- Dropped the `drizzle-orm` (`eq`) and `../db/schema` (`ais`) imports.
- Added a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise(effect)`.
- `ownerOf` now runs `` SELECT owner FROM ais WHERE id = ${aiId} LIMIT 1 `` through `runSql` and keeps the same throw when there is no row.

**`api.ts`**
- Dropped the `drizzle-orm` (`and`, `eq`) import and the `../db/schema` value import; added `SqlClient`/`type SqlError` from `effect/sql`, `sqlRuntimeFor` from `../effect/sql`, and `getTopic` + `type TopicRow` from `../topics/access`.
- Added the same private `runSql(db, effect)` helper.
- Topic-by-id reads at the two `Effect.gen` handlers now call `getTopic(db, id)` (`const [topic] = …` became `const topic = …`; the `!topic` checks are unchanged).
- `toolAccess` and `toolAccessIncludingDeleted` also read their topic with `getTopic`.
- `listToolsForGroup` reads its topics with `` sql<TopicRow>`SELECT * FROM topics WHERE group_id = ${groupId}` ``.
- The remaining reads (group_ais/topic_ais `ai_id` sets, `ais.owner` by id, the five `ai_tools` columns, `findOwnedAiRow`, `findMembership`) are `effect/sql` statements selecting the same columns through `runSql`; those inside `Effect.gen` handlers stay wrapped in `Effect.promise(() => runSql(...))`.

### Files changed
- `apps/server/src/tools/adapters.ts`
- `apps/server/src/tools/api.ts`
- `work/T-0647-tools-api-adapters-effect-sql.md` (front matter status + this Report)

### Verification
- `git grep -n "drizzle-orm" apps/server/src/tools/api.ts apps/server/src/tools/adapters.ts` → no output.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/routes src/tools/adapters` → 2 test files passed, 46 tests passed.
- `pnpm gate` (repo root) summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (17.4s)
  PASS  lint  (1.2s)
  PASS  typecheck  (12.9s)
  PASS  tests @zilar/server  (25.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- Dropped the `../db/schema` import entirely rather than keeping a type-only import: none of its types are referenced after the conversion (`TopicRow` comes from `../topics/access`).
- No blocking questions.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean. The packet head is 5f3f1166, the current HEAD.
- **Lead check:**
  - each effect/sql statement selects the same columns as the drizzle query it replaces;
  - topic-by-id reads go through `getTopic`;
  - there is no drizzle import left in `tools/api.ts` or `tools/adapters.ts`.
