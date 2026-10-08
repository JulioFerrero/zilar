---
id: T-0615
title: "effect/sql: tools/service.ts off drizzle except deleteToolsForAiInGroup (it receives a drizzle transaction from groups/service.ts:1099); save/revert keep SELECT … FOR UPDATE and the create race (ON CONFLICT DO NOTHING then append to the winner); recordRun keeps insert + prune-to-50 in one transaction; tests unchanged"
status: todo
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

## Review (written by Claude)
