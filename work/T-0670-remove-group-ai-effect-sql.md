---
id: T-0670
title: "effect/sql phase 2 (C1/C2/C5): move the removeGroupAi transaction in groups/service.ts onto sql.withTransaction using the phase-1 Effects, then delete the drizzle revokeActiveRulesForAiInGroup, deleteToolsForAiInGroup and deleteRoutinesForAiInGroup"
status: merged
milestone: M5
branch: task/T-0670-remove-group-ai-effect-sql
model: auto
effort: low
depends_on: [T-0663, T-0664, T-0665, T-0666]
estimate: 0.3 day
---

# T-0670: removeGroupAi on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. Phase 1 (T-0663 to T-0666, merged) added an Effect version of each helper that `removeGroupAi` passes its drizzle `tx` into. This task moves that transaction and deletes the drizzle helpers that are left with no caller.

### Verified facts (do not re-derive)
- **`apps/server/src/groups/service.ts:1033` `removeGroupAi`:** its transaction is at lines 1067-1117, inside `try { … } catch (error) { throw mapXmppError(error); }` (lines 1066-1120; `mapXmppError` at line 1310 passes an `HttpError` through and makes anything else a 503). Inside, in this order:
  1. `await adminClient.setAffiliation(group.roomLocalpart, ai.jid, 'none')`;
  2. delete the `group_ais` row (`group_id`, `ai_id`);
  3. select `id, room_localpart` from `topics` where `group_id`;
  4. if there are topic ids, delete the `topic_ais` rows with `topic_id IN ids AND ai_id`;
  5. `revokeActiveRulesForAiInGroup(tx, { aiId, groupId, actorId, now: new Date() })`;
  6. `deleteToolsForAiInGroup(tx, { aiId, groupId, now })`;
  7. `deleteRoutinesForAiInGroup(tx, { aiId, groupId, now })`;
  8. `deleteRoomMemory(tx, aiId, [...new Set([group.roomLocalpart, ...topic room_localparts])])`.
- **The phase-1 Effects** (all `Effect<…, SqlError, SqlClient>`):
  - `revokeActiveRulesForAiInGroupEffect` in `apps/server/src/approvals/rules.ts`;
  - `deleteToolsForAiInGroupEffect` in `apps/server/src/tools/service.ts`;
  - `deleteRoutinesForAiInGroupEffect` in `apps/server/src/routines/service.ts`;
  - `deleteRoomMemoryEffect(aiId, roomLocalparts)` in `apps/server/src/agents/memory/store.ts`.
- **groups/service.ts is all drizzle today.** It imports the four drizzle helpers at lines 27-30.
- **The recipe:**
  - a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise(effect)`, as in `apps/server/src/ais/service.ts:27-32`;
  - `sql.withTransaction(Effect.gen(…))`;
  - an outside call inside the transaction goes through `Effect.tryPromise({ try: () => …, catch: (error) => error })`, so the caller gets the same error object (see `ais/service.ts:568`);
  - lists go through `sql.in(ids)`.
- **Callers that stay:** `apps/server/src/topics/service.ts:920` and `:924` still call the drizzle `deleteToolsForAiInTopic` and `deleteRoomMemory` with `deps.db`. **Keep those two drizzle functions.**
- **Tests:**
  - `apps/server/src/groups/groups.test.ts:985-1260` covers removal: who may remove, 403, topic rows (T-0109), rules (T-0099), tools (T-0103) and routines (T-0104);
  - the drizzle-only tests to delete are `apps/server/src/approvals/rules.test.ts` (the test calling `revokeActiveRulesForAiInGroup` at about line 727; the Effect copy at about line 768 stays) and `apps/server/src/tools/service.test.ts` (the `deleteToolsForAiInGroup` test at about lines 785-834; the Effect copy at about line 872 stays).

### What to build
1. **`groups/service.ts`:** add `runSql` and the imports. Replace the `db.transaction(...)` at 1067-1117 with `runSql(db, Effect.gen(… sql.withTransaction(…)))`. Run the same 8 steps in the same order, with step 1 through `Effect.tryPromise` and steps 5-8 through the phase-1 Effects with `now: new Date()`. Keep the surrounding `try/catch` with `mapXmppError`, and keep everything after the commit as it is.
2. **Swap the imports** at lines 27-30 for the Effect versions.
3. **Delete the drizzle helpers:** `revokeActiveRulesForAiInGroup` (`approvals/rules.ts`), `deleteToolsForAiInGroup` (`tools/service.ts`) and `deleteRoutinesForAiInGroup` (`routines/service.ts`), along with their "stays on drizzle" comments. Update the comments above the Effect versions. Remove imports that become unused.
4. **Delete the two drizzle-only tests** named above, and fix their imports. Every other test stays unchanged.

### Read first
`AGENTS.md`, `apps/server/src/groups/service.ts` (lines 1-40, 1025-1135, 1305-1316), `apps/server/src/ais/service.ts` (lines 20-35, 555-610), the four phase-1 Effects.

### Allowed files
`apps/server/src/groups/service.ts`, `apps/server/src/approvals/rules.ts`, `apps/server/src/approvals/rules.test.ts`, `apps/server/src/tools/service.ts`, `apps/server/src/tools/service.test.ts`, `apps/server/src/routines/service.ts`, `work/T-0670-remove-group-ai-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/groups.test src/approvals/rules.test src/tools/service.test src/routines/service.test
pnpm gate
```

### Acceptance
- `removeGroupAi` has no `db.transaction`.
- The three drizzle helpers are gone.
- `groups/groups.test.ts` passes unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done.

**What I did**

1. `apps/server/src/groups/service.ts`
   - Added `Effect`, `SqlClient`/`SqlError` and `sqlRuntimeFor` imports, plus a private `runSql(db, effect)` (same shape as `ais/service.ts`).
   - Replaced the `db.transaction(...)` in `removeGroupAi` (was lines 1067-1117) with `runSql(db, Effect.gen(... sql.withTransaction(Effect.gen(...))))`, keeping the 8 steps in the same order:
     1. `adminClient.setAffiliation` through `Effect.tryPromise({ try, catch: (error) => error })`;
     2. `DELETE FROM group_ais` raw SQL;
     3. `SELECT id, room_localpart FROM topics WHERE group_id` raw SQL;
     4. `DELETE FROM topic_ais WHERE topic_id IN ${sql.in(topicIds)} AND ai_id` raw SQL (only when there are topic ids);
     5-7. the phase-1 Effects `revokeActiveRulesForAiInGroupEffect`, `deleteToolsForAiInGroupEffect`, `deleteRoutinesForAiInGroupEffect` with `now: new Date()`;
     8. `deleteRoomMemoryEffect(input.aiId, [...new Set([...])])`.
   - Kept the surrounding `try/catch` with `mapXmppError` and everything after the commit unchanged. Swapped the four drizzle helper imports for the Effect versions.
2. Deleted the three drizzle helpers and updated the comments: `revokeActiveRulesForAiInGroup` (`approvals/rules.ts`), `deleteToolsForAiInGroup` (`tools/service.ts`), `deleteRoutinesForAiInGroup` (`routines/service.ts`). In `routines/service.ts` the now-unused `import { and, eq, isNull } from 'drizzle-orm'` was removed. `deleteToolsForAiInTopic` (still called by `topics/service.ts` and driven in a drizzle txn by its test) and `deleteRoomMemory` (still called by `topics/service.ts` and `agents/memory/cleanup.test.ts`) were left untouched, and the stale "stays on drizzle" wording that named `deleteToolsForAiInGroup` was rewritten to name the surviving helper.
3. Deleted the two drizzle-only tests named in the spec and their imports: `rules.test.ts` ("kills the AI rules for the group…", now only the Effect test remains) and `tools/service.test.ts` (the first `it` in `describe('deleteToolsForAiInGroup')`; the Effect and topic tests stay). `apps/server/src/agents/memory/store.ts` was **not** touched (it is not in the Allowed files, and `deleteRoomMemory` stays).

**Files changed** (7, all inside Allowed files)
- `apps/server/src/groups/service.ts`
- `apps/server/src/approvals/rules.ts`
- `apps/server/src/approvals/rules.test.ts`
- `apps/server/src/tools/service.ts`
- `apps/server/src/tools/service.test.ts`
- `apps/server/src/routines/service.ts`
- `work/T-0670-remove-group-ai-effect-sql.md` (status/report only)

**Commands and real results**
- `pnpm install`: done, 1176 packages, only pre-existing peer-dep/deprecated warnings.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/groups.test src/approvals/rules.test src/tools/service.test src/routines/service.test`: 4 test files passed, 153 tests passed (65.41s).
- `pnpm gate` (repo root):
  - `PASS install (frozen) (1.9s)`
  - `PASS format (32.7s)`
  - `PASS lint (2.0s)`
  - `PASS typecheck (4.5s)`
  - `PASS tests @zilar/server (91.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Acceptance**
- `removeGroupAi` no longer has a `db.transaction` (now `runSql` + `sql.withTransaction`).
- The three drizzle helpers are gone (grep finds no remaining references; only the `describe('deleteToolsForAiInGroup')` test-group name in `service.test.ts` remains).
- `groups/groups.test.ts` passes unchanged.
- `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files.

**Deviations / notes**
- The spec's item 3 mentions updating "the comments above the Effect versions"; `store.ts` was left as-is because it is outside the Allowed files, and its `deleteRoomMemory` function was kept per the spec.
- The removal keeps the original per-call `new Date()` timestamps (steps 5-7), exactly as the pre-existing drizzle code did, so the transaction/audit timestamps behave as before.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean; the packet head is 761e199d, the current HEAD.
- **Result:** `removeGroupAi` runs one `sql.withTransaction` with the same 8 steps in order. The XMPP failure still rolls back and maps to 503. The three drizzle helpers are gone, with no references left.
- **Nit for a later tools task:** the `describe('deleteToolsForAiInGroup')` name in `tools/service.test.ts` is now stale.
