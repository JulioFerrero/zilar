---
id: T-1029
title: "Size split T73: apps/server/src/agents/tools.ts (536 lines) into agents/tools/{schemas,parse,definitions,reply-lines}.ts, the old path a barrel"
status: merged
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

### What I did
Split `apps/server/src/agents/tools.ts` (536 lines on main) into four new files under `apps/server/src/agents/tools/`, leaving the original path as a thin barrel. Code moved unchanged; both Dedup items (`stripControlChars`, the schema-keyed decode table) were skipped as the spec says. No importer changed.

- `apps/server/src/agents/tools/schemas.ts` — tool-name constants, length caps, the eight Effect argument schemas and `ParsedToolArguments` (plan lines 5–113).
- `apps/server/src/agents/tools/parse.ts` — `TOOL_NAME_MAX_LENGTH`, `safeToolName`, `parseToolArguments` and the private `decodeToolArguments` (plan lines 115–260). Imports `firstIssueReason` from `../tool-arg-issues`.
- `apps/server/src/agents/tools/definitions.ts` — `ChatToolDefinition`, `PERSONA_TOOLS`, `MEMORY_TOOLS`, `buildRequestActionTool`, `buildDelegateTool`, `TASK_STATUS_TOOL_DEF`, `buildTools`, `buildGroupTools` (plan lines 262–503).
- `apps/server/src/agents/tools/reply-lines.ts` — `formatPersonaUpdatedLine`, `PERSONA_RESTORED_LINE`, `formatRememberedLine`, `sanitizeSummary` (plan lines 505–536).
- `apps/server/src/agents/tools.ts` — barrel re-exporting every name with the same names and kinds, so every `./tools` import keeps working.

### Line counts (`wc -l`)
| File | Lines |
|---|---|
| `apps/server/src/agents/tools.ts` (old, main) | 536 |
| `apps/server/src/agents/tools.ts` (barrel) | 50 |
| `apps/server/src/agents/tools/schemas.ts` | 112 |
| `apps/server/src/agents/tools/parse.ts` | 168 |
| `apps/server/src/agents/tools/definitions.ts` | 256 |
| `apps/server/src/agents/tools/reply-lines.ts` | 34 |

Every file is under 400, and no `max-lines` warning appears (gate `lint` PASS).

### Export list, before → after
Base export names (36) and the union of the four new files' export names (36) are identical: no name added or removed. The four type exports are `ParsedToolArguments` and `ChatToolDefinition`, both re-exported with `export type`; the other 32 are values.

```
before (main tools.ts, grep -E "^export"): 36 names
after  (tools/{schemas,parse,definitions,reply-lines}.ts, grep -E "^export"): 36 names
diff: empty (only in before: none; only in after: none)
barrel not missing any name
```

### Commands run
```
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/agents/reply.test.ts
  → Test Files 1 passed (1); Tests 4 passed (4)

pnpm gate
  → gate: 6 changed file(s) against main
    PASS  install (frozen)  (1.3s)
    PASS  format  (1.8s)
    PASS  lint  (1.3s)
    PASS  typecheck  (4.9s)
    PASS  effect  (1.2s)
    PASS  tests @zilar/server  (5.2s)
    scope: every changed file is inside the Allowed files
    GATE PASS
```

### Effect ratchet
No `// effect-plain:` marker was needed and none was added. `schemas.ts` and `parse.ts` import `effect` as a value (kind `effect`); `definitions.ts` and `reply-lines.ts` carry no hard/weak signal (kind `plain`); the barrel is `plain`. Gate printed `PASS effect`.

### Files changed
`apps/server/src/agents/tools.ts`, `apps/server/src/agents/tools/schemas.ts`, `apps/server/src/agents/tools/parse.ts`, `apps/server/src/agents/tools/definitions.ts`, `apps/server/src/agents/tools/reply-lines.ts`, `work/T-1029-split-server-agent-tools.md`.

### Deviations / open questions
None. Both Dedup items were skipped as the spec requires.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `agents/tools.ts` (536 lines) is now a 50-line barrel, plus `agents/tools/{schemas,parse,definitions,reply-lines}`. The largest is `definitions` at 256.
- **The lead's line check:** the old file's non-import code lines against the new files'. No line was lost, and the only extras are names in import and export lists, so the tool-argument parsing is unchanged.
- **Check:** the lead ran `reply.test.ts` on the branch (4 passed); it loads the barrel through `reply.ts` and `tool-loop.ts`. The gate passed.
