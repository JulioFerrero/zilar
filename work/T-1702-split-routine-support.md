---
id: T-1702
title: "Size split of apps/server/src/routines/support.ts (380 lines): move the three bulk soft-deletes (deleteRoutinesForAiInTopic, deleteRoutinesForAiInGroupEffect, deleteRoutinesForTool) into a new routines/deletes.ts; routines/service.ts re-exports them from there — a pure move"
status: merged
milestone: M5
branch: task/T-1702-split-routine-support
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1702: Split the bulk routine deletes out of routines/support.ts

## Spec (written by Claude, do not edit)

### Why
`apps/server/src/routines/support.ts` is 380 of 400 lines. The scheduled AI jobs work (prompt routines) keeps touching this module. The three bulk soft-deletes are a self-contained block, like the tool deletes that T-1685 moved out of `tools/mutations.ts`.

### Facts (the lead read them on 2026-10-16)
- **`support.ts`:**
  - imports `:1-34` (`Effect`, `SqlClient`, `SqlError`, `ServerDatabase`, `runSql`, …);
  - `createRoutine :35` (it calls `safeStringify` at `:53`), `pauseRoutine :160`, `resumeRoutine :213` and `deleteRoutine :280-317`;
  - **the block to move:**
    - the comment `// Soft-deletes every active routine of one AI in one topic. …` (`:319-320`) and `export async function deleteRoutinesForAiInTopic(db, input) :321-…`;
    - `export function deleteRoutinesForAiInGroupEffect(input) :340-…` (with its comment);
    - `export async function deleteRoutinesForTool :357-372` (with its comment);
  - then `function safeStringify(value) :374-380`, which stays because `createRoutine` uses it.
- **Importers:** only `apps/server/src/routines/service.ts:35-43` imports from `./support` (`export { createRoutine, pauseRoutine, resumeRoutine, deleteRoutine, deleteRoutinesForAiInTopic, deleteRoutinesForAiInGroupEffect, deleteRoutinesForTool } from './support';`). Everyone else imports these through `routines/service`.
- **The folder `apps/server/src/routines/`** has no `deletes.ts`.

### Steps
1. **Create `apps/server/src/routines/deletes.ts`** with the three functions and their comments moved **word for word**, plus the imports they need. It must not import from `./support` or `./service`.
2. **`support.ts`:** delete the block, keep `safeStringify`, and drop the imports it no longer uses.
3. **`service.ts`:** re-export the three from `./deletes`, and keep `createRoutine`, `pauseRoutine`, `resumeRoutine` and `deleteRoutine` from `./support`. No other importer changes.
4. **No behaviour change, no new tests.**

### Allowed files
- `apps/server/src/routines/deletes.ts`
- `apps/server/src/routines/support.ts`
- `apps/server/src/routines/service.ts`
- `work/T-1702-split-routine-support.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines --reporter=dot
pnpm gate
```

### Acceptance
- **`support.ts` is about 325 lines,** and `deletes.ts` holds the three functions unchanged.
- **The `src/routines` tests and the server typecheck pass.**

---

## Report (written by the worker when done)

### What I did
Moved the three bulk soft-deletes out of `apps/server/src/routines/support.ts`
into a new `apps/server/src/routines/deletes.ts`, word for word:

- `deleteRoutinesForAiInTopic` (`support.ts` was `:318-335`)
- `deleteRoutinesForAiInGroupEffect` (was `:337-353`)
- `deleteRoutinesForTool` (was `:355-372`)

New file `deletes.ts` imports only `Effect` (`effect`), `SqlClient`/`SqlError`
(`effect/sql`), `ServerDatabase` (`../db/client`) and `runSql` (`../effect/sql`);
it does not import from `./support` or `./service`.

`support.ts` kept `createRoutine`, `pauseRoutine`, `resumeRoutine`,
`deleteRoutine` and `safeStringify`, and dropped the now-unused `SqlError`
import (`SqlClient` is still used by `createRoutine`). It is 324 lines.

`service.ts` now re-exports `createRoutine`, `pauseRoutine`, `resumeRoutine`
and `deleteRoutine` from `./support`, and the three bulk deletes from
`./deletes`. No other importer changed.

No behaviour change, no new tests.

### Checks run
- `pnpm install` — done, 1137 packages, no errors.
- `pnpm --filter @zilar/server exec vitest run src/routines --reporter=dot` — `Test Files 4 passed (4)`, `Tests 16 passed (16)`.
- `pnpm gate` (from the repo root) — `GATE PASS`, summary lines:
  - `gate: 4 changed file(s) against main`
  - `PASS  install (frozen)  (2.2s)`
  - `PASS  format  (1.4s)`
  - `PASS  lint  (1.7s)`
  - `PASS  typecheck  (5.3s)`
  - `PASS  effect  (1.3s)`
  - `PASS  tests @zilar/server  (10.7s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- `wc -l`: `support.ts` 324, `deletes.ts` 63.

### Notes for the lead
- The three moved functions are byte-for-byte identical to the originals; the
  only edits to `support.ts` are the removed block and the dropped `SqlError`
  import.
- Files changed: `apps/server/src/routines/deletes.ts`,
  `apps/server/src/routines/support.ts`,
  `apps/server/src/routines/service.ts`, and this task file.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:**
  - the removed lines equal `deletes.ts` apart from its header;
  - `service.ts` now re-exports the three deletes from `./deletes` and the other four from `./support`.
- **The tests:** the lead ran `src/routines` in the worktree: 4 files, 16 tests passed.
- **Result:** `routines/support.ts` drops from 380 to 324 lines.
