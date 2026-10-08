---
id: T-0615
title: "effect/sql: tools/service.ts off drizzle except deleteToolsForAiInGroup (it receives a drizzle transaction from groups/service.ts:1099); save/revert keep SELECT … FOR UPDATE and the create race (ON CONFLICT DO NOTHING then append to the winner); recordRun keeps insert + prune-to-50 in one transaction; tests unchanged"
status: merged
milestone: M5
branch: task/T-0615-effect-sql-tools-service
model: auto
effort: low
depends_on: [T-0604]
estimate: 1.5 days
---

# T-0615: the tool service on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example at `apps/server/src/pins/service.ts:179`. `apps/server/src/tools/service.ts` (about 1070 lines, 40 query sites, 4 transactions) is the largest service left on drizzle.

### Verified facts (do not re-derive; read the whole file)
**The exception.** `deleteToolsForAiInGroup` (from 578) is called by `apps/server/src/groups/service.ts:1099` **with a drizzle transaction** (`tx as unknown as ServerDatabase`). It **stays on drizzle, unchanged**, together with any private helper only it uses. The file therefore keeps the drizzle imports it needs. This is the same precedent as `connections/service.ts` `decryptForGatewayUse` (T-0587). Everything else converts.

**`deleteToolsForAiInTopic`** (556) is called by `apps/server/src/topics/service.ts:920` with `deps.db` (no transaction), so it converts.

**`saveToolVersion`** (122-260 or so; read the comment at 122-133):
- **create path:**
  - `findActiveTool`, `enforceToolLimit`, then a transaction (155);
  - insert `ai_tools` with `ON CONFLICT DO NOTHING RETURNING` (171);
  - if a row was inserted, `insertVersion` v1;
  - **else (lost the race)**, re-read the winner with `findActiveTool` **inside the transaction** and `appendVersion` to it;
- **update path:** a transaction (222) with `SELECT … FOR UPDATE` on the tool row (228); an identical save returns `unchanged: true` and writes nothing;
- the audit is written **after** the commit, as today.

**The other transactions:**
- `revertTool`: a transaction (477) with `FOR UPDATE` (483);
- `recordRun` (859): inserts the run, then prunes runs beyond the newest 50, in one transaction; output text is truncated to 2 KiB.

**Helpers** used inside and outside transactions (`findActiveTool`, `insertVersion`, `appendVersion`, and others) become Effects that `yield*` `SqlClient`, so they use the transaction connection inside `withTransaction`.

**Errors:** `ToolServiceError` codes and messages stay byte-identical. An error thrown inside a transaction must roll back and reach the caller unchanged; read `apps/server/src/chat-folders/service.ts` (lines 150-280).

**jsonb:** `hosts` and `approved_hosts` are string arrays (unaffected by key renaming). Write jsonb as `${JSON.stringify(v)}::jsonb` (`docs/EFFECT_GUIDE.md`, effect/sql section).

**Test fakes:** the lead checked `apps/server/src/tools/*.test.ts` for patched `db.transaction` or fake `{ select }` dbs, and found none.

**Tests (all unchanged):**
- `apps/server/src/tools/*.test.ts`;
- `apps/server/src/routines/*.test.ts`;
- `apps/server/src/groups/*.test.ts`;
- `apps/server/src/topics/*.test.ts`;
- the authz sweep (`authz-sweep`).

### What to build
1. Convert every function except `deleteToolsForAiInGroup` (and helpers only it uses), with the same locks, the same race handling, the same pruning and the same errors.
2. In the Report, list the drizzle code left and why.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/chat-folders/service.ts` (lines 150-280) and `apps/server/src/tools/service.ts`.

### Allowed files
`apps/server/src/tools/service.ts`, `work/T-0615-effect-sql-tools-service.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot tools routines groups topics authz-sweep
pnpm gate
```

### Acceptance
- The tool service runs on effect/sql except the one function that receives a drizzle transaction, with the same behaviour.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

`apps/server/src/tools/service.ts` now runs on `effect/sql` for every function
except the two that receive a **drizzle transaction**. The exported functions
stay `async` and return the same shapes; each private helper takes the
`SqlClient` and returns an `Effect`, and `runSql(db, effect)` (`sqlRuntimeFor(db).runPromise`)
is the only bridge. Tests are unchanged.

Converted: `saveToolVersion`, `appendVersion`, `listTools`, `getTool`,
`listVersions`, `getVersion`, `revertTool`, `deleteTool`, `runToolVersion`,
`approveToolHosts`, `revokeToolHosts`, `listRuns`, `recordRun`, `findActiveTool`,
`enforceToolLimit`, `getToolRow`, `listToolsForAi`, and the private helpers
`insertVersion` / a new `latestRunStatus` (the "newest run status" query was
repeated six times; it is now one helper with identical SQL).

Behaviour kept byte-identical:
- `saveToolVersion`: create path is `insert ai_tools … ON CONFLICT DO NOTHING
  RETURNING *`; a lost race re-reads the winner **inside the same transaction**
  (the `DO NOTHING` never aborts it) and appends v1+; update path is a
  transaction with `SELECT … FOR UPDATE`. Audit is written after the commit,
  only when `!unchanged`.
- `revertTool`: transaction with `SELECT … FOR UPDATE`; history untouched.
- `recordRun`: insert + prune-to-newest-50 in **one** transaction; output
  truncated to 2 KiB first.
- jsonb `hosts` / `approved_hosts` written as `${JSON.stringify(v)}::jsonb`.
- `ToolServiceError` codes/messages and the internal `Error`s (`Effect.die`)
  are unchanged; a failure inside a transaction rolls back and reaches the
  caller as the same instance.

### Drizzle left in the file, and why

1. `deleteToolsForAiInGroup` — the spec's exception: `groups/service.ts:1099`
   passes it a drizzle transaction (`tx as unknown as ServerDatabase`).
2. `deleteToolsForAiInTopic` — **deviation from the spec.** The spec says it
   converts because production (`topics/service.ts:920`) calls it with
   `deps.db`. But `apps/server/src/tools/service.test.ts:857` drives it inside
   `context.db.transaction(...)` and passes the raw `tx`; converting it made
   that unchanged test fail with `No effect/sql runtime registered for this
   database` (there is no runtime keyed on a transaction object, and I cannot
   add one without touching the test or `effect/sql.ts`, neither of which is an
   allowed file). Keeping it on drizzle passes the test unchanged and still
   works in production (`deps.db` supports the same `.update(...)`). Its only
   neighbour use is the same drizzle builder the group function already needs,
   so the file keeps `and, eq, isNull`, `aiTools` and no other drizzle builder.
3. Outside this file, `deleteTool` still calls `deleteRoutinesForTool(db, …)`
   from `routines/service.ts`, which is still drizzle (another task's scope).

Also removed a dangling trailing comment in the original file ("How many
versions a tool has …") that referred to no function.

### Commands run (real results)

- `pnpm install` — done, 18.4s, no changes.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/service.test.ts`
  — first run **45 passed, 1 failed** (`deleteToolsForAiInTopic` runtime lookup);
  after keeping that function on drizzle: **46 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot routines groups topics authz-sweep`
  — **10 files, 186 passed** (authz sweep lists 158 `/api` routes).
- `pnpm exec prettier --write apps/server/src/tools/service.ts` — after the
  first gate flagged formatting; reformatted only that file.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/visibility.test.ts src/search/search.test.ts`
  — **2 files, 51 passed**, after the gate run saw those two hooks time out
  (see below).
- `pnpm gate` — first run: format FAIL (fixed with prettier). Second run:
  `tests @zilar/server` FAIL with two `Hook timed out in 30000ms` in
  `groups/visibility.test.ts` and `search/search.test.ts` (both pass
  individually, above) — unrelated to this change and read as load flakiness on
  the shared machine. Third run: **GATE PASS**.

### Gate summary (final run)

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (5.5s)
PASS  format  (84.7s)
PASS  lint  (2.1s)
PASS  typecheck  (1.5s)
PASS  tests @zilar/server  (619.7s)
scope: every changed file is inside the Allowed files
GATE PASS
```

Changed files: `apps/server/src/tools/service.ts`,
`work/T-0615-effect-sql-tools-service.md` (both allowed).

### Open questions / notes

- The spec's claim that `deleteToolsForAiInTopic` converts is not compatible
  with the unchanged `service.test.ts`; I kept it on drizzle as above. If the
  lead wants it on effect/sql, the test's transaction wrapper (or a runtime for
  transaction objects) has to change in a follow-up task.
- Security checklist: deletes/updates stay scoped by tool/AI/topic id; the
  version cap is still enforced with the row lock taken before the state is
  read; the tool cap and its race handling are unchanged from the drizzle
  version; audit entries still carry ids plus the tool name/version only.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit and 1 follow-up. The packet (21:27) is newer than HEAD 50f9f76a.
- **No test file changed.**
- **Lead check:**
  - the four transactions keep `FOR UPDATE`, the create-race append and prune-to-50;
  - the gate passes.
- **Accepted deviation:** `deleteToolsForAiInTopic` stays on drizzle beside `deleteToolsForAiInGroup`, because `service.test.ts:857` drives it inside a raw drizzle transaction. Converting it needs that test changed; that is a follow-up.
- **Nit:** the header comment at 125-129 says "the one exception".
