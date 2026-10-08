---
id: T-0679
title: "effect/sql cleanup: delete the now-unused drizzle deleteToolsForAiInTopic (tools/service.ts) and deleteRoomMemory (agents/memory/store.ts) with their drizzle-only tests; fix the stale comments in tools, memory and voice"
status: merged
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

**What I did**
- `tools/service.ts`: deleted `deleteToolsForAiInTopic` and its comment; removed the drizzle import (`and, eq, isNull`), which had no other user; rewrote the header comment so it no longer calls it "the one exception".
- `tools/service.test.ts`: deleted the drizzle test `deleteToolsForAiInTopic soft-deletes only that topic tools` and its import; renamed the describe to `'AI removal deletes'`. The Effect tests stay.
- `agents/memory/store.ts`: deleted `deleteRoomMemory`, its drizzle comment and the drizzle import (`and, eq, sql`). The import of the four `aiMemory*` tables was also unused afterwards and was removed (lint caught it on the first gate run). Rewrote the header sentence that said it "stays on drizzle", and the T-0666 comment above `deleteRoomMemoryEffect`.
- `agents/memory/cleanup.test.ts`: deleted the two drizzle tests (`deleteRoomMemory deletes only one AI…`, `… does nothing for an empty list`) and the `deleteRoomMemory` import. The `drizzle-orm` import stays because `countMemory` still uses `and`/`eq`.
- `voice-transcription/api.ts` header: "Handlers keep calling the drizzle pipeline; the DB rewrite is a separate lane" now says the handlers call the pipeline and the database runs on effect/sql.
- `voice-transcription/pipeline.ts` header: "The Hono route handlers and zod validation stay as they are" now says the Effect HttpApi handlers in `api.ts` call this module and validate with Effect Schema. I also changed "between the Hono handlers" to "between the HTTP handlers" in the same header.
- Behaviour: none changed. Only the drizzle-only functions and their tests were removed.

**Callers checked first**: `git grep` over `apps packages` found no production caller of `deleteRoomMemory` or `deleteToolsForAiInTopic`. The only remaining users were their tests. The old comment in `store.ts` said `groups/service.ts` called `deleteRoomMemory` inside `removeGroupAi`, but that is no longer true, so the Effect version is the only one in use.

**Commands run**
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/service.test src/agents/memory/cleanup.test`: 2 files passed, 50 tests passed.
- Acceptance greps: `git grep -n "deleteToolsForAiInTopic\b\|deleteRoomMemory\b" apps/server/src` finds nothing (the `…Effect` names do not match `\b`). `git grep drizzle` in `tools/service.ts` and `agents/memory/store.ts` finds nothing.
- First `pnpm gate`: FAIL at lint (the four unused `aiMemory*` imports in `store.ts`). Fixed by removing that import line.
- Final `pnpm gate` (exit 0):
  ```
  PASS  install (frozen)  (1.9s)
  PASS  format  (36.8s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.8s)
  PASS  tests @zilar/server  (56.8s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The gate reported 7 changed files against main, all in the Allowed list.

**Deviations**: the T-0442 paragraph ("removing an AI from a room deletes that room's memory at once…") was kept above `deleteRoomMemoryEffect`, because it describes what the remaining Effect function does. I did not delete it with the drizzle comment.

**Open questions**: none. The Effect variants `deleteToolsForAiInTopicEffect` and `deleteToolsForAiInGroupEffect` in `tools/service.ts` are kept, as the spec says.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 5 min). The lead reviewed the diff directly.
- **Result:** both drizzle deletes and their drizzle-only tests are gone, the describe is renamed, and the voice headers now describe today's state. `tools/service.ts` and `agents/memory/store.ts` no longer import drizzle. The gate passed.
- **Correction, mine:** my acceptance grep used a `\b` that cannot match before `Effect`; the worker reported this correctly.
