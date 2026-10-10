---
id: T-1029
title: "Size split T73: apps/server/src/agents/tools.ts (536 lines) into agents/tools/{schemas,parse,definitions,reply-lines}.ts, the old path a barrel"
status: todo
milestone: M5
branch: task/T-1029-split-server-agent-tools
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1029: Split `agents/tools.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/agents/tools.ts` is 536 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #69 (task T73). The new files go in a new `apps/server/src/agents/tools/` folder: `schemas.ts`, `parse.ts`, `definitions.ts` and `reply-lines.ts`. `apps/server/src/agents/tools.ts` stays at its path as the barrel and re-exports every name it exports today, so every `./tools` import keeps working.

Move the code unchanged, and skip both Dedup items. `parse.ts` decodes the tool arguments a model sends, before any permission check, so not one line of it changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #69, and `apps/server/src/agents/tools.ts`.

### Allowed files
`apps/server/src/agents/tools.ts`, `apps/server/src/agents/tools/schemas.ts`, `apps/server/src/agents/tools/parse.ts`, `apps/server/src/agents/tools/definitions.ts`, `apps/server/src/agents/tools/reply-lines.ts`, `work/T-1029-split-server-agent-tools.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/agents/reply.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

## Review (written by Claude)
