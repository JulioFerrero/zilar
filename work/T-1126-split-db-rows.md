---
id: T-1126
title: "Size split: apps/server/src/db/rows.ts (426) — the approval, tool, routine and media row types move unchanged to db/rows-agents.ts, re-exported with export *"
status: merged
milestone: M5
branch: task/T-1126-split-db-rows
model: auto
effort: default
depends_on: [T-1122]
estimate: 0.05 day
---

# T-1126: Split `db/rows.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is 400 lines per source file (2026-10-10). `apps/server/src/db/rows.ts` has 426 lines of row interfaces only (read by the lead), and many server files import it.

**The interfaces to move, from `ApprovalRow` (`:267`) to the end:** `ApprovalRow`, `ApprovalInsert` (`:288`), `PendingActionRow` (`:309`), `ApprovalRuleRow` (`:327`), `AiToolRow` (`:340`), `AiToolVersionRow` (`:356`), `AiToolRunRow` (`:368`), `RoutineRow` (`:382`) and `MediaItemRow` (`:405`).

### What to build
1. **A new `apps/server/src/db/rows-agents.ts`** holds `:267` to the end, **moved byte-for-byte** (comments included).
2. **`rows.ts`** keeps `:1-266` and adds `export * from './rows-agents';` at the end, so every importer keeps working.
   - If a moved interface refers to one that stays, import it in `rows-agents.ts` with `import type`.
   - `rows.ts` must not import `rows-agents.ts` other than through the `export *`.
3. **No type changes.**
4. **Line counts:** both files stay at most 400 lines. Paste `wc -l` in the Report.
5. **No tests** (types only); the gate typechecks.

### Read first
`AGENTS.md`, and `apps/server/src/db/rows.ts`.

### Allowed files
`apps/server/src/db/rows.ts`, `apps/server/src/db/rows-agents.ts`, `work/T-1126-split-db-rows.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- Both files are at most 400 lines.

---

## Report (written by the worker when done)

### What I did
- Moved the row interfaces from `ApprovalRow` to the end of `apps/server/src/db/rows.ts` into the new `apps/server/src/db/rows-agents.ts`, byte-for-byte (comments included). I also moved the `// Row of the \`approvals\` table.` doc comment with its interface, since it documents the moved block.
- `rows.ts` keeps the rest and ends with `export * from './rows-agents';`, so every existing importer keeps working. No type changes.
- No moved interface refers to one that stays, so `rows-agents.ts` needs no imports.

### Files changed
- `apps/server/src/db/rows.ts` (trimmed to the first part + re-export)
- `apps/server/src/db/rows-agents.ts` (new)
- `work/T-1126-split-db-rows.md` (this task file)

### Commands and results
- `pnpm install` — done in 25.2s.
- `wc -l apps/server/src/db/rows.ts apps/server/src/db/rows-agents.ts` → `266` and `161` (427 total). Both at most 400 lines.
- No single test file run (types only, no test files near the change).
- `pnpm gate` — summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.9s)
  PASS  lint  (1.2s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- The spec says `rows.ts` keeps `:1-266` and the new file holds `:267`-end. Line 266 is the `approvals` doc comment; I moved it with the interface it documents (per "comments included") so no orphan comment is left behind.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The split:** `db/rows.ts` goes from 426 to 266 lines. The approval, tool, routine and media row types move to `db/rows-agents.ts` (161), and `rows.ts` ends with `export * from './rows-agents';`.
- **The lead's line check:** every line removed from `rows.ts` is present in `rows-agents.ts`.
- **The gate passed** (types only).
