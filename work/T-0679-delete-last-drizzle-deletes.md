---
id: T-0679
title: "effect/sql cleanup: delete the now-unused drizzle deleteToolsForAiInTopic (tools/service.ts) and deleteRoomMemory (agents/memory/store.ts) with their drizzle-only tests; fix the stale comments in tools, memory and voice"
status: todo
milestone: M5
branch: task/T-0679-delete-last-drizzle-deletes
model: auto
effort: low
depends_on: [T-0676]
estimate: 0.1 day
---

# T-0679: delete the last drizzle deletes

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. After T-0670 and T-0676, the drizzle `deleteToolsForAiInTopic` and `deleteRoomMemory` have no production caller; only their own tests call them. Their Effect versions (with tests) are what the callers use now. Removing them leaves `tools/service.ts` and `agents/memory/store.ts` with no drizzle.

### Verified facts (do not re-derive)
- **`apps/server/src/tools/service.ts`:**
  - `deleteToolsForAiInTopic(tx, …)` is at about line 615, with its comment at about lines 610-614;
  - the header comment at about lines 124-128 calls it "the one exception";
  - the drizzle import is at line 4 (`and, eq, isNull`), and this function is its only user;
  - the test is `apps/server/src/tools/service.test.ts:785-830`, `it('deleteToolsForAiInTopic soft-deletes only that topic tools')`, which drives it inside `context.db.transaction`. It sits inside `describe('deleteToolsForAiInGroup', …)` at line 784, a name that is stale since T-0670. The Effect tests in that block stay.
- **`apps/server/src/agents/memory/store.ts`:**
  - `deleteRoomMemory(db, …)` is at about line 531 (drizzle), with its comment at about lines 520-530;
  - the header (lines 7-10) says it "stays on drizzle";
  - the drizzle import is at line 15 (`and, eq, sql`); check that nothing else in the file uses it;
  - the T-0666 comment at about line 578 refers to it;
  - its tests are `apps/server/src/agents/memory/cleanup.test.ts:241-265` (two tests that call `deleteRoomMemory(context.db, …)`). Their Effect copies follow and stay.
- **Stale voice comments:**
  - `apps/server/src/voice-transcription/api.ts:1-6` says "Handlers keep calling the drizzle pipeline; the DB rewrite is a separate lane" (it is done: T-0669 and T-0673);
  - `apps/server/src/voice-transcription/pipeline.ts:1-9` says "The Hono route handlers and zod validation stay as they are" (Hono and zod are gone from these routes).

### What to build
1. **Delete** `deleteToolsForAiInTopic` and its comment, the drizzle import in `tools/service.ts` (if it is then unused), and the drizzle test. Rename the `describe` at line 784 to `'AI removal deletes'`, and fix the header comment.
2. **Delete** `deleteRoomMemory` and its comment, plus the drizzle import if it is unused. Fix the header and the T-0666 comment, and delete the two drizzle tests (keep the Effect ones and fix the import).
3. **Rewrite the two voice header sentences** so they describe today's state: Effect HttpApi handlers, and effect/sql for the database.
4. **Change no behaviour.**

### Read first
`AGENTS.md`, then the files and line ranges above.

### Allowed files
`apps/server/src/tools/service.ts`, `apps/server/src/tools/service.test.ts`, `apps/server/src/agents/memory/store.ts`, `apps/server/src/agents/memory/cleanup.test.ts`, `apps/server/src/voice-transcription/api.ts`, `apps/server/src/voice-transcription/pipeline.ts`, `work/T-0679-delete-last-drizzle-deletes.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/service.test src/agents/memory/cleanup.test
pnpm gate
```

### Acceptance
- `git grep -n "deleteToolsForAiInTopic\b\|deleteRoomMemory\b" apps/server/src` finds only the `…Effect` names.
- `tools/service.ts` and `agents/memory/store.ts` have no drizzle import.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
