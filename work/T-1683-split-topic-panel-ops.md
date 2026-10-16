---
id: T-1683
title: "Size split of apps/web/src/components/panels/topicPanelOps.ts (398 lines): move the generic list helpers (PanelStatus, storeCall, ListState, useListLoader, removeRow) into a new panels/panelLists.ts and re-export PanelStatus and storeCall so no importer changes — a pure move"
status: merged
milestone: M5
branch: task/T-1683-split-topic-panel-ops
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1683: Split the list helpers out of topicPanelOps.ts

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/components/panels/topicPanelOps.ts` is 398 of 400 lines, so the next topic panel change can't land. Its first third is generic list plumbing that doesn't depend on the topic.

### Facts (the lead read them on 2026-10-16)
- **`topicPanelOps.ts`:**
  - the imports `:1-21`;
  - `export type PanelStatus :23`;
  - `export const storeCall` (with its doc comment, `:25-39`);
  - `type ListState :41-45`;
  - `function useListLoader :47-…` (with its doc comment);
  - `function removeRow :123-…` (with its doc comment, which starts a few lines above);
  - then the doc comment and `export function useTopicPanelOps :150-…`.
  - `useListLoader` is used at `:169` and `:176`, `removeRow` at `:268` and `:284`, both inside `useTopicPanelOps` only.
- **Importers:**
  - `apps/web/src/components/TopicPanel.tsx:16` (`import { storeCall, useTopicPanelOps } from './panels/topicPanelOps';`);
  - `apps/web/src/components/panels/TopicRolesSection.tsx:18` (`import { storeCall, type PanelStatus } from './topicPanelOps';`).
- **The folder `apps/web/src/components/panels/`** has no `panelLists.ts`.

### Steps
1. **Create `apps/web/src/components/panels/panelLists.ts`** with `PanelStatus`, `storeCall`, `ListState`, `useListLoader` and `removeRow`, moved **word for word** with their comments.
   - Export all five.
   - Bring only the imports they need (for example `Effect`, `useEffect`/`useState`, `ApiError`, `ApiFailure`, `toApiFailure`, `useQuery`, as the block uses them).
2. **`topicPanelOps.ts`:**
   - imports what it uses from `./panelLists`;
   - adds `export { storeCall, type PanelStatus } from './panelLists';` so both importers keep working unchanged;
   - drops the imports it no longer uses.
3. **No behaviour change, no new tests.**

### Allowed files
- `apps/web/src/components/panels/panelLists.ts`
- `apps/web/src/components/panels/topicPanelOps.ts`
- `work/T-1683-split-topic-panel-ops.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`topicPanelOps.ts` is about 270 lines,** and `panelLists.ts` holds the helpers unchanged.
- **The web typecheck and build pass.**

---

## Report (written by the worker when done)

### What I did

Moved the generic list plumbing out of `topicPanelOps.ts` into a new `panelLists.ts`, word for word:

- Created `apps/web/src/components/panels/panelLists.ts` with `PanelStatus`, `storeCall`, `ListState`, `useListLoader` and `removeRow`, plus only the imports they use (`Effect`, `useState`, `ApiError`, `fromApi`, `ApiFailure`, `toApiFailure`, `useQuery`, `textOf`). All five are exported as the spec requires.
- `topicPanelOps.ts` now imports `useListLoader`, `removeRow` and `storeCall` from `./panelLists`, re-exports `storeCall` and `PanelStatus` with `export { storeCall, type PanelStatus } from './panelLists';`, and drops the imports it no longer uses (`ApiError`, `toApiFailure`, `textOf`).
- Verified the move is exact with `diff` against `HEAD`:
  - `panelLists.ts` body vs original `topicPanelOps.ts:23-143` differs only by the three added `export` keywords.
  - `topicPanelOps.ts:25-278` is byte-identical to the original `:145-398`.
- Line counts: `topicPanelOps.ts` 398 → 278 lines; `panelLists.ts` 129 lines.
- No behaviour change, no new tests. Both importers (`TopicPanel.tsx:16`, `TopicRolesSection.tsx:18`) keep working unchanged.

### Checks run

- `pnpm gate` (from repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.9s)
  PASS  lint  (1.3s)
  PASS  typecheck  (5.7s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- The 3 changed files are `apps/web/src/components/panels/panelLists.ts`, `apps/web/src/components/panels/topicPanelOps.ts` and `work/T-1683-split-topic-panel-ops.md` — all in the Allowed files.
- No separate test file run: the change is a pure move and the gate reports no nearby test files for `@zilar/web`.

### Notes for the lead

- The spec said "moved word for word" and "Export all five"; these conflict slightly, so I added `export` to `ListState`, `useListLoader` and `removeRow` (the other two were already exported). The `diff` above confirms those are the only differences from the original block.
- No deviations, no blockers.

## Review (written by Claude)

**Approved and merged.** A pure size split.

- **Pre-review:** clean, 0 nits.
- **The lead's check:** the removed lines equal `panelLists.ts` exactly (diff after stripping imports and `export`).
- **Result:** `topicPanelOps.ts` drops from 398 to 278 lines, and both importers are unchanged through the re-export.

