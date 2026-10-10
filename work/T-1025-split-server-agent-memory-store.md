---
id: T-1025
title: "Size split T60: apps/server/src/agents/memory/store.ts (572 lines) into memory/{mirror,render,recall,facts,compaction,state}.ts, the old path keeps constants and re-exports"
status: merged
milestone: M5
branch: task/T-1025-split-server-agent-memory-store
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1025: Split `agents/memory/store.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/agents/memory/store.ts` is 572 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #56 (task T60). The new files go in `apps/server/src/agents/memory/`:
- `mirror.ts`;
- `render.ts`;
- `recall.ts`;
- `facts.ts`;
- `compaction.ts`;
- `state.ts`.

`memory/store.ts` keeps the constants and re-exports of every name it exports today. The folder already holds `api.ts`, `compactor.ts`, `indexer.ts`, `secrets.ts` and `tree.ts`; leave them as they are.

Move the code unchanged, and skip both Dedup items, because they cross files. The `ai_id AND chat_key` predicate keeps each AI's memory to its own chat, which is permissions code: not one line of it changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #56, and `apps/server/src/agents/memory/store.ts`.

### Allowed files
`apps/server/src/agents/memory/store.ts`, `apps/server/src/agents/memory/mirror.ts`, `apps/server/src/agents/memory/render.ts`, `apps/server/src/agents/memory/recall.ts`, `apps/server/src/agents/memory/facts.ts`, `apps/server/src/agents/memory/compaction.ts`, `apps/server/src/agents/memory/state.ts`, `work/T-1025-split-server-agent-memory-store.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Followed `docs/audit/split-rules.md` and `docs/audit/size-plan.md` §2.2 #56. Split `apps/server/src/agents/memory/store.ts` into the six named files and left the old path a thin barrel. Code moved unchanged; the two Dedup items were skipped (the spec says so, because they cross files), and the `ai_id AND chat_key` scope predicate is untouched. No importer, test or file outside the Allowed list was edited.

### `wc -l` before and after

| file | lines |
| --- | --- |
| `agents/memory/store.ts` (old, `main`) | 572 |
| `agents/memory/store.ts` (barrel, now) | 27 |
| `agents/memory/mirror.ts` | 146 |
| `agents/memory/render.ts` | 106 |
| `agents/memory/recall.ts` | 102 |
| `agents/memory/facts.ts` | 107 |
| `agents/memory/compaction.ts` | 89 |
| `agents/memory/state.ts` | 70 |

Every new file and the barrel is well under 400 lines; the `max-lines` warning is gone.

Module contents: `mirror.ts` keeps the (AI, chat) range and the raw reads (`MEMORY_WINDOW`, `MemoryRange`, `MemoryRow`, `blockKey`, `halves`, `formatDate`, `formatRow`, `readFloor`, `readTotal`, `memoryRange`, `loadRows`, `loadSingle`, `loadNodeMap`); `render.ts` keeps `resolveFloor`, `RenderContext`, `collectBlock`, `renderMemoryBlock`; `recall.ts` keeps `MEMORY_RECALL_MAX`, `escapeLike`, `recallMemory`, `zoomMemory`; `facts.ts` keeps `MEMORY_FACTS_MAX`, `MemoryFact`, `listFacts`, `AddFactResult`, `addFact`, `deleteFact`; `compaction.ts` keeps `pendingNodes`, `compactionInput`, `putNode`, `buildCompactionPrompt`; `state.ts` keeps `deleteRoomMemoryEffect`, `clearMemory`.

### Export list before and after (diff)

`git show HEAD:apps/server/src/agents/memory/store.ts | grep -E "^export"` gives 19 names. The barrel re-exports the same 19 with the same kinds (16 values, 3 types):

```
values: MEMORY_WINDOW, MEMORY_FACTS_MAX, MEMORY_RECALL_MAX,
        memoryRange, renderMemoryBlock,
        recallMemory, zoomMemory,
        listFacts, addFact, deleteFact,
        pendingNodes, compactionInput, putNode, buildCompactionPrompt,
        deleteRoomMemoryEffect, clearMemory
types:  MemoryRange, MemoryFact, AddFactResult
```

Barrel re-export lines:

```
export { MEMORY_FACTS_MAX } from './facts';
export type { AddFactResult, MemoryFact } from './facts';
export { addFact, deleteFact, listFacts } from './facts';
export { MEMORY_RECALL_MAX } from './recall';
export { recallMemory, zoomMemory } from './recall';
export { MEMORY_WINDOW } from './mirror';
export type { MemoryRange } from './mirror';
export { memoryRange } from './mirror';
export { renderMemoryBlock } from './render';
export { buildCompactionPrompt, compactionInput, pendingNodes, putNode } from './compaction';
export { clearMemory, deleteRoomMemoryEffect } from './state';
```

The only names exported anywhere under `memory/` that were not exported before are the split's internal cross-module helpers, which never reach the barrel: from `mirror.ts` — `MemoryRow`, `blockKey`, `halves`, `formatRow`, `readFloor`, `loadRows`, `loadSingle`, `loadNodeMap`. No public name is added, removed or changes kind.

### Effect ratchet

`render.ts` holds only moved `async` code and has no value `effect` import, so it carries the sanctioned first-line marker `// effect-plain: moved unchanged from apps/server/src/agents/memory/store.ts (size split)` (split-rules item 6). The other five new files import `Effect`/`effect/sql` as values and classify `effect`. The barrel is `plain`. The gate's effect step passed.

### Commands run

- `pnpm install` — done (1172 packages added).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/reply.test.ts` — 1 file passed, 4 tests passed. (The `agents/memory` folder has no test file any more, so the reply pipeline test is the nearest one that imports `memory/store` through `tool-exec`.)
- `pnpm gate` (from the repo root) — **GATE PASS**:

```
gate: 8 changed file(s) against main
PASS  install (frozen)  (2.4s)
PASS  format  (1.5s)
PASS  lint  (1.1s)
PASS  typecheck  (4.2s)
PASS  effect  (1.8s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations from the spec

The plan said the barrel "keeps constants + re-exports (26–51)". I put each constant in the module that uses it (`MEMORY_WINDOW` in `mirror.ts`, `MEMORY_RECALL_MAX` in `recall.ts`, `MEMORY_FACTS_MAX` in `facts.ts`) and the barrel re-exports them; the two interfaces `MemoryRange` and `MemoryFact` likewise live in `mirror.ts`/`facts.ts`. Keeping them literally in the barrel would force the moved modules to import the barrel, which is a cycle. The public surface is identical.

### Problems / open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `agents/memory/store.ts` (572 lines) keeps the constants and the re-exports (27 lines), plus `mirror`, `render`, `recall`, `facts`, `compaction` and `state`. Each is at most 146 lines.
- **The lead's line check:** the old file's non-import code lines against the new files'. The only differences are the import lists and `readFloor`'s signature, which Prettier wrapped once `export` was added. The `ai_id`/`chat_key` scoping is unchanged.
- **Check:** the gate passed.
