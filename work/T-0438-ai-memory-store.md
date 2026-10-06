---
id: T-0438
title: "AI memory M2b (server): memory store helpers: render the memory block, recall, zoom, facts, pending nodes, compaction prompt, clear"
status: merged
milestone: M5
branch: task/T-0438-ai-memory-store
model: auto
effort: low
depends_on: [T-0433]
estimate: 0.5 day
---

# T-0438: AI memory — store helpers

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/ai-memory-plan.md` §3.3-§3.7. These are the database helpers the gateway (M3) and the routes (M4) will call. **No schema change, no gateway or route wiring.** T-0437 (the indexer) runs in parallel and owns `agents/memory/indexer.ts`; do not touch it.

### Verified facts (do not re-derive)
- **Tables** (T-0433, `apps/server/src/db/schema.ts`):
  - `aiMemoryMessages` (aiId, chatKey, seq, messageId, at, sender, text, deleted);
  - `aiMemoryNodes` (aiId, chatKey, lo, hi, summary, createdAt);
  - `aiMemoryFacts` (id, aiId, chatKey, text, createdAt);
  - `aiMemoryState` (aiId, chatKey, indexedThroughMicros, floorSeq).
- **Tree core:** `apps/server/src/agents/memory/tree.ts`, which provides:
  - `cover(total, budget, minBlock=16)` → aligned blocks covering `[0,total)`, finest at the end;
  - `pending(total, built, minBlock=16)`;
  - `parseBlockId(id)` and `formatBlockId(b)`;
  - the constants `MEMORY_MIN_BLOCK` 16, `MEMORY_WAKE_LINES` 48 and `MEMORY_LINE_MAX` 280.
- **The window:** the gateway shows the last 50 messages verbatim, so memory covers `[floorSeq, end)` where `end = max(0, total − 50)` and `total` = max seq + 1.
- **Test setup:** `createTestContext()` from `apps/server/src/test-support.ts:303`, as in `apps/server/src/media/indexer.test.ts:264-266`. Insert AIs the way existing tests do; find an `ais` insert helper in `apps/server/src/ais/*.test.ts`.

### What to build
New `apps/server/src/agents/memory/store.ts`. Every function takes `(db, aiId, chatKey, …)`, and none of them ever logs text.

1. **`MEMORY_WINDOW = 50`**, `MEMORY_FACTS_MAX = 50`, `MEMORY_RECALL_MAX = 30`.
2. **`memoryRange(db, aiId, chatKey)`** → `{ total, floor, end }` with `end = max(floor, total − MEMORY_WINDOW)`.
3. **`renderMemoryBlock(db, aiId, chatKey, budget = MEMORY_WAKE_LINES)`** → `string[]`, oldest first:
   - **Tiling:** take `cover(end, budget)` and drop blocks with `hi <= floor`. A block that straddles `floor` is replaced by its children, recursively, until none straddle.
   - **Each block:**
     - **size 1:** the row as `#<seq> <YYYY-MM-DD> <sender>: <text>` (skip deleted rows);
     - **size ≥ 16 with a node:** `#<lo>-<hi-1> <summary>`;
     - **without a node:** its two halves, recursively; a block of size 16 with no node becomes its raw rows.
   - **Budget:** if the expansion goes over `budget` lines, keep the newest `budget` lines.
4. **`recallMemory(db, aiId, chatKey, query)`:**
   - split the query into words (max 8);
   - match rows that are not deleted, have `seq >= floor`, and contain every word case-insensitively;
   - escape `%`, `_` and `\` and use `ILIKE '%word%'`; **never** take a regex from the input;
   - return the newest `MEMORY_RECALL_MAX` as lines, oldest first, plus a count note when there were more ("Newest 30 of N matches.");
   - an empty query → `[]`.
5. **`zoomMemory(db, aiId, chatKey, blockId)`:** `parseBlockId`, then its two halves, each as a node summary or (size ≤ 16 / no node) the raw rows. An invalid or out-of-range id → `null`.
6. **Facts:**
   - `listFacts` (oldest first);
   - `addFact(text)`: trim; reject empty, multi-line or longer than 280, or a case-insensitive duplicate (`'duplicate'`); then insert, and when there are more than 50 delete the oldest. It returns `'saved' | 'duplicate' | 'invalid'`;
   - `deleteFact(factId)`: scoped by aiId and chatKey, returns a boolean.
7. **Nodes:**
   - `pendingNodes(db, aiId, chatKey, limit)`: use `pending(end, built)`, keeping only blocks with `lo >= floor`, smallest first, up to `limit`;
   - `compactionInput(db, aiId, chatKey, block)`: for a size-16 block, the raw rows (deleted ones skipped), as lines; for a larger one, the two child summaries;
   - `putNode(…, block, summary)`: cut to 280 and insert; on a conflict, do nothing.
8. **`buildCompactionPrompt(blockId, inputLines)`**, pure. Text: "Compress chat memory #a-b into one line of at most 280 characters. Keep what has lasting effect (decisions, facts, preferences, plans, who said what that matters); drop small talk. Invent nothing. Never include passwords, codes, keys or tokens. Reply with the line only." followed by the input lines.
9. **`clearMemory(db, aiId, chatKey)`:** in one transaction, delete every node and fact of the chat and upsert `floorSeq = total`.

**New `apps/server/src/agents/memory/store.test.ts`:**
- `renderMemoryBlock`:
  - is empty while total ≤ 50;
  - shows raw rows below the window when they fit;
  - uses node summaries when nodes exist;
  - expands a missing node into its halves or rows;
  - never goes over budget and keeps the newest;
  - respects `floor`.
- `recallMemory`:
  - matches every word, case-insensitive;
  - `%` and `_` in the query are literal;
  - deleted rows and rows below `floor` are not returned;
  - caps at 30 with the note.
- `zoomMemory`: halves for a valid id, `null` for a bad one.
- Facts: add, duplicate, invalid, the cap drops the oldest, and delete is scoped (another AI's fact id → false).
- `pendingNodes` and `compactionInput` follow the tree.
- `clearMemory` empties nodes and facts and moves the floor.
- Scope: another AI's or another chat's rows never appear.

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md` §3.3-§3.7, `apps/server/src/agents/memory/tree.ts`, `apps/server/src/db/schema.ts` (the `aiMemory*` tables), `apps/server/src/media/indexer.test.ts:255-300`.

### Allowed files
`apps/server/src/agents/memory/store.ts`, `apps/server/src/agents/memory/store.test.ts`, `work/T-0438-ai-memory-store.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/store
pnpm gate
```

### Acceptance
- The store helpers render, recall, zoom, manage facts, list pending nodes, build the compaction input and prompt, and clear, all scoped to one AI and chat.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Built `apps/server/src/agents/memory/store.ts` as the database layer over the
`aiMemory*` tables, plus `store.test.ts`. No schema change, no gateway or route
wiring, and `agents/memory/indexer.ts` was not touched (it does not exist in
this worktree yet).

Exports:

- `MEMORY_WINDOW` (50), `MEMORY_FACTS_MAX` (50), `MEMORY_RECALL_MAX` (30).
- `memoryRange` → `{ total, floor, end }` with `end = max(floor, total − 50)`.
- `renderMemoryBlock` — `cover(end, budget)` (`budget` defaults to
  `MEMORY_WAKE_LINES` 48), blocks below `floor` dropped and a straddling block
  opened into halves until none straddle; a block renders as a node summary, a
  size-16 block as its raw rows, or is opened into its halves; deleted rows are
  skipped. Collected newest-first so it stops once the budget is met, then the
  newest `budget` lines are returned oldest-first.
- `recallMemory` — words split and capped at 8, every word a case-insensitive
  `ILIKE` with `%`, `_` and `\` escaped (`ESCAPE '\'`), never a regex; `seq >=
  floor` and not deleted; newest 30, oldest-first, plus `Newest 30 of N matches.`
  when more matched; empty query → `[]`.
- `zoomMemory` — `parseBlockId`, then its two halves as a summary or raw rows;
  `null` for a malformed id, a block below `floor`, or one past `total`.
- `listFacts`, `addFact`, `deleteFact`; `pendingNodes`; `compactionInput`;
  `putNode` (cut to 280, `onConflictDoNothing`); pure `buildCompactionPrompt`;
  `clearMemory`.

### Files changed

- `apps/server/src/agents/memory/store.ts` (new)
- `apps/server/src/agents/memory/store.test.ts` (new)
- `work/T-0438-ai-memory-store.md` (status + this Report)

### Commands I ran

- `pnpm install` — done in 13.7s, no lockfile change.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/store`
  — 1 file, 23 tests passed. (Ran once mid-work and once after the final edit;
  both green.)
- `pnpm gate` — ends with:
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (0.9s)`
  - `PASS  format  (13.6s)`
  - `PASS  lint  (0.5s)`
  - `PASS  typecheck  (6.5s)`
  - `PASS  tests @zilar/server  (8.5s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- I ran `pnpm exec prettier --write` on my two new files before the gate so its
  `format:check` passed; no other file was touched.

### Deviations / decisions (small, spec-ambiguous)

- `compactionInput` for a block larger than 16 returns the two child summaries
  as plain lines (no `#lo-hi` prefix), matching the plan wording "the two child
  summaries" (OptMem feeds the child summaries straight into the prompt). If the
  lead wants ids there, it is a one-line change.
- The tree's `splitBlock` is private, so the floor straddle and the
  no-node expansion use a local `halves(block)` (literal midpoint). For the
  valid cover sizes (1 or ≥ 16) this yields the same lines as the tree's
  one-block rule; a straddling size-16 block still ends up as raw singles.
- `addFact`'s duplicate check and 50-fact cap run in one transaction under a
  per-chat `pg_advisory_xact_lock`, re-reading inside it, per the AGENTS
  atomicity rule (the literal spec did not mention a lock).
- `listFacts` returns `{ id, text }` oldest-first; that is what the routes need.
- `clearMemory` returns `void` and leaves the mirror messages in place (the plan
  says they stay for recall and the recent window).

### Blocked / needs a decision

None.

## Review (written by Claude)

Approved (lead, 2026-10-06). store.ts reads the mirror for the gateway: memoryRange (window 50 above the floor), renderMemoryBlock (newest lines within 48, summaries as #lo-hi, raw rows where no node exists), recallMemory (all words ILIKE with escaped wildcards, newest 30 plus a count note), zoomMemory, facts (trim, one line, case-insensitive duplicate, cap 50 under an advisory lock), pendingNodes, compactionInput, putNode, buildCompactionPrompt and clearMemory (floor moves to the end). Every query is scoped by AI and chat; nothing is logged. Nits, carried to M3: compactionInput gives child summaries without their #lo-hi id; putNode cuts by UTF-16 units.
