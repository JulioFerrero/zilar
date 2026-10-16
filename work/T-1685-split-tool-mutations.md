---
id: T-1685
title: "Size split of apps/server/src/tools/mutations.ts (393 lines): move the three soft-deletes (deleteTool, deleteToolsForAiInTopicEffect, deleteToolsForAiInGroupEffect) into a new tools/deletes.ts; tools/service.ts re-exports them from there — a pure move"
status: merged
milestone: M5
branch: task/T-1685-split-tool-mutations
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1685: Split the tool deletes out of tools/mutations.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/tools/mutations.ts` is 393 of 400 lines, so the next tool-version change can't land. The three soft-deletes at its end are self-contained.

### Facts (the lead read them on 2026-10-16)
- **`mutations.ts`:**
  - imports `:1-28` (`deleteRoutinesForTool` from `../routines/service` at `:7`; `ToolRow` from `./queries`);
  - `saveToolVersion :50`, `appendVersion :213` and `revertTool :269`;
  - **then the block to move:**
    - the comment `// Soft-deletes one tool by id, …` (`:337-339`) and `export async function deleteTool(db, toolId, now) :340-363`;
    - the comment `// Effect versions of the two deletes (T-0664): …` (`:365-367`), `export function deleteToolsForAiInTopicEffect :368-…` and `export function deleteToolsForAiInGroupEffect :380-393`.
- **Importers:**
  - only `apps/server/src/tools/service.ts:118-124` imports from `./mutations` (`export { deleteTool, deleteToolsForAiInGroupEffect, deleteToolsForAiInTopicEffect, revertTool, saveToolVersion } from './mutations';`);
  - everyone else imports the deletes from `tools/service` (`tools/routes.ts:22-29`, `groups/ais.ts:12`, `topics/ais.ts:10`).
- **The folder `apps/server/src/tools/`** has no `deletes.ts`.

### Steps
1. **Create `apps/server/src/tools/deletes.ts`** with the three functions and their comments moved **word for word**, plus the imports they need (`Effect`, `SqlClient`, `SqlError`, `ServerDatabase`, `runSql`, `deleteRoutinesForTool`, and the `ToolRow` type from `./queries`).
2. **`mutations.ts`:** delete the block and drop the imports it no longer uses.
3. **`service.ts`:** re-export `deleteTool`, `deleteToolsForAiInGroupEffect` and `deleteToolsForAiInTopicEffect` from `./deletes`, and keep `revertTool` and `saveToolVersion` from `./mutations`. No other importer changes.
4. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/tools/deletes.ts`
- `apps/server/src/tools/mutations.ts`
- `apps/server/src/tools/service.ts`
- `work/T-1685-split-tool-mutations.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/tools --reporter=dot
pnpm gate
```

### Acceptance
- **`mutations.ts` is about 335 lines,** and `deletes.ts` holds the three functions unchanged.
- **The `src/tools` tests pass,** and the server typecheck passes.

---

## Report (written by the worker when done)

### What I did
Pure move, no behaviour change, no new tests:
- Created `apps/server/src/tools/deletes.ts` (64 lines) holding `deleteTool`,
  `deleteToolsForAiInTopicEffect` and `deleteToolsForAiInGroupEffect` with their
  comments moved word for word, plus only the imports they need (`Effect`,
  `SqlClient`, `SqlError`, `ServerDatabase`, `runSql`, `deleteRoutinesForTool`,
  `ToolRow`).
- `apps/server/src/tools/mutations.ts`: removed that block and dropped the now
  unused `deleteRoutinesForTool` import. It is now 334 lines (was 393).
- `apps/server/src/tools/service.ts`: the three deletes now re-export from
  `./deletes`; `revertTool` and `saveToolVersion` stay from `./mutations`. No other
  importer changed (grep confirms `service.ts` is the only importer of
  `tools/mutations`).

Changed files: `apps/server/src/tools/deletes.ts`, `apps/server/src/tools/mutations.ts`,
`apps/server/src/tools/service.ts`, `work/T-1685-split-tool-mutations.md`.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools`
  → 1 test file passed, 5 tests passed, 0 failed.
- `pnpm gate` → GATE PASS. Summary lines:
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen) (1.8s)`, `PASS  format (0.7s)`, `PASS  lint (1.0s)`,
    `PASS  typecheck (5.8s)`, `PASS  effect (1.7s)`, `PASS  tests @zilar/server (7.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `size: every changed source file is within 400 lines`
  - `GATE PASS`

### Notes for the lead
- `mutations.ts` came out at 334 lines rather than the spec's "about 335"; the three
  functions and their comments are byte-for-byte the same as before.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:**
  - the removed lines equal `deletes.ts` exactly;
  - `service.ts` re-exports the deletes from `./deletes`, so no other importer changed.
- **The tests:** the lead ran `src/tools` in the worktree: 1 file, 5 tests passed.
- **Result:** `mutations.ts` drops from 393 to 334 lines.
