---
id: T-0960
title: "Size split T3+T4: apps/server/src/agents/reply.ts (1,585 lines) into agents/{tool-loop,dm-turn,group-turn}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-0960-split-server-agents-reply
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0960: Split `agents/reply.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/agents/reply.ts` is 1,585 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written. The plan splits it in two tasks (T3, T4); this task does both, because they are one file.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #2: `agents/tool-loop.ts`, `agents/dm-turn.ts`, `agents/group-turn.ts`, under `apps/server/src/`. `agents/reply.ts` becomes the barrel.

The plan's ranges give `tool-loop.ts` and `dm-turn.ts` about 450 to 500 lines each. Split each once more along a boundary the entry names (`split-rules.md` item 4): `tool-loop.ts` plus `tool-exec.ts` (execute and redact), and `dm-turn.ts` plus `dm-tool-turn.ts` (`runToolTurn`).

This is the AI reply pipeline (message pipeline), so it is crucial: move the code unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #2, and `apps/server/src/agents/reply.ts`.

### Allowed files
`apps/server/src/agents/reply.ts`, `apps/server/src/agents/tool-loop.ts`, `apps/server/src/agents/tool-exec.ts`, `apps/server/src/agents/dm-turn.ts`, `apps/server/src/agents/dm-tool-turn.ts`, `apps/server/src/agents/group-turn.ts`, `work/T-0960-split-server-agents-reply.md`.

### Checks
```bash
pnpm gate
```
The gate runs the nearest server tests. Also run any kept server test that imports from `agents/reply` (find them with grep) with `--reporter=dot`, and list them in the Report.

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
