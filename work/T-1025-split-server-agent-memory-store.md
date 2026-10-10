---
id: T-1025
title: "Size split T60: apps/server/src/agents/memory/store.ts (572 lines) into memory/{mirror,render,recall,facts,compaction,state}.ts, the old path keeps constants and re-exports"
status: todo
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

## Review (written by Claude)
