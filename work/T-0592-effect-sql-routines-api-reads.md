---
id: T-0592
title: "effect/sql: the inline drizzle reads in routines/api.ts (topic rows for canSeeTopic, group topics, routine by id, AI owner, owned AI, membership) move to effect/sql; rows keep their drizzle shapes; same access rules and 404s; tests unchanged"
status: merged
milestone: M5
branch: task/T-0592-effect-sql-routines-api-reads
model: auto
effort: low
depends_on: [T-0588]
estimate: 0.5 day
---

# T-0592: the routines API reads on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. `apps/server/src/routines/api.ts` serves on Effect HTTP but still runs 10 inline drizzle selects, all on `deps.db` with no transaction. `routines/service.ts` is out of scope. T-0588 moved `scheduler.ts` and `execute.ts`, and added `apps/server/src/routines/db.ts`.

### Verified facts (do not re-derive)
- **Imports:** `and`, `eq` (line 16); `ais`, `groupMembers`, `routines`, `topics` (21).
- **The reads:**
  - (186) `SELECT * FROM topics WHERE id LIMIT 1`, then `canSeeTopic(db, topic: TopicRow, userId)` (`topics/access.ts:116`, which takes the **full** row);
  - (212) `SELECT * FROM topics WHERE group_id = $1`, giving full rows;
  - (401) `SELECT * FROM routines WHERE id LIMIT 1`, a `RoutineRow` (`typeof routines.$inferSelect`, with the jsonb columns `schedule`, `input` and `approved_hosts` decoded);
  - (418-422) and (451-455) `SELECT owner FROM ais WHERE id LIMIT 1`;
  - (430) and (466) the topic by id;
  - (479-483) `SELECT id FROM ais WHERE id = $1 AND owner = $2 LIMIT 1`;
  - (488-492) `SELECT role FROM group_members WHERE group_id AND user_id LIMIT 1`.
- **Row shapes.** Effect/sql already maps snake_case to camelCase (`transformResultNames: snakeToCamel`, `apps/server/src/effect/sql.ts`), so `SELECT *` gives camelCase keys. Type the results as `TopicRow` and `RoutineRow` (type-only imports), so `canSeeTopic` and the access helpers stay unchanged.
- **The sql runtime:** reuse the helper in `apps/server/src/routines/db.ts` (from T-0588) if it fits, or a local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)`.
- **When done:** `routines/api.ts` has no value import from `drizzle-orm` or `db/schema`.
- **Tests (all unchanged):**
  - `apps/server/src/routines/*.test.ts`;
  - the authz sweep (`authz-sweep`).

### What to build
1. Move the 10 reads to effect/sql, with the same rows, access rules, 404s and deleted-routine handling (`deletedAccessFor`).
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/routines/api.ts` (lines 170-495), `apps/server/src/routines/db.ts`, `apps/server/src/effect/sql.ts` and `apps/server/src/topics/access.ts` (lines 110-140).

### Allowed files
`apps/server/src/routines/api.ts`, `apps/server/src/routines/db.ts`, `work/T-0592-effect-sql-routines-api-reads.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot routines authz-sweep
pnpm gate
```

### Acceptance
- `routines/api.ts` reads through effect/sql with the same answers.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: review.

### What I did

- Moved every inline drizzle select in `apps/server/src/routines/api.ts` (9 calls) onto `effect/sql`, through the existing `runSql` helper in `routines/db.ts` and the `SqlClient` tagged template.
- Added small async read helpers: `findTopicById`, `listTopicsByGroup`, `findRoutineById`, `findAiOwner`; converted `findOwnedAiRow` and `findMembership` in place.
- Typed the rows as `TopicRow` (type-only import from `../topics/access`) and `RoutineRow` (type-only import from `./service`). `SELECT *` comes back camelCased through `transformResultNames`, so `canSeeTopic`, `accessFor`/`deletedAccessFor` and the wire mappers stay unchanged.
- Removed the `drizzle-orm` and `db/schema` value imports; `api.ts` now has no value import from either. `topics/access.ts` and `routines/service.ts` were not touched (out of scope), so `canSeeTopic`'s own internal reads still run on drizzle.

Reads converted: topics by id (listForAi), topics by group (listForGroup), routines by id (delete access), `ais.owner` ×2, topic by id ×2, owned ai id, `group_members.role`. Access rules, 404s and the deleted-routine (`deletedAccessFor`) handling are byte-for-byte the same logic.

### Files changed

- `apps/server/src/routines/api.ts`
- `work/T-0592-effect-sql-routines-api-reads.md`

### Commands and results

- `pnpm install`: done, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/service.test.ts`: 1 file passed, 19 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts`: 1 file passed, 5 tests passed.
- `pnpm gate` (first run): GATE FAIL — `@zilar/server#typecheck` TS4104 at `src/routines/api.ts:483`: `sql<TopicRow>` returns a readonly array, `listTopicsByGroup` promised a mutable `TopicRow[]`.
- Fix: return `[...rows]` from `listTopicsByGroup`.
- `pnpm gate` (final): GATE PASS; `gate: 2 changed file(s) against main`; `PASS install (frozen) / format / lint / typecheck / tests @zilar/server`; `scope: every changed file is inside the Allowed files`.

### Notes / deviations

- The spec says "10 inline drizzle selects"; `api.ts` contained 9 `select(...)` calls, and all 9 are now on effect/sql. No read was left behind; the tenth in the spec's prose is counted in `canSeeTopic`'s internals (`topics/access.ts`, out of scope).
- Tests are unchanged: no test file was edited.
- `routines/db.ts` already fit (`runSql`), so it was not modified.

### Open questions

- None.

### Security checklist

- No secrets logged; no logging, routes or permission checks changed; unknown and invisible resources still answer the same 404; no writes or rate limits added.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (13:37) is newer than HEAD 8bc601d3.
- **No test file changed.**
- **Lead check:** grep finds no `drizzle-orm` or `db/schema` import in `routines/api.ts`, and the 10 reads go through effect/sql with the `TopicRow` and `RoutineRow` shapes.
