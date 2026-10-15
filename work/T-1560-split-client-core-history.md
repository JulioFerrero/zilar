---
id: T-1560
title: "Split packages/client-core/src/store/history.ts (399 lines): the history types, constants and small state helpers (HistoryState/Patch/Set/Ctx, dedupePage, setHistoryState, clearSupersededMarker, canLoadHistory, waitForHistory) move to store/history-core.ts; history.ts keeps the loaders and re-exports every name; no behaviour change"
status: merged
milestone: M5
branch: task/T-1560-split-client-core-history
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1560: Split client-core history.ts

## Spec (written by Claude, do not edit)

### Why
`packages/client-core/src/store/history.ts` is 399 lines. Web and phone share it to load chat history (the message pipeline). **Follow `docs/audit/split-rules.md`.**

### Facts (the lead read them on main, 2026-10-15)
- **Constants and types (`:11-76`):**
  - `PREVIEW_HISTORY_MAX` (`:11`), `PAGE_HISTORY_MAX` (`:12`), `MESSAGE_JUMP_MAX_PAGES` (`:15`), `MESSAGE_JUMP_WAIT_MS` (`:18`);
  - `HistoryLoad` (`:22`), `HistoryState` (`:25`), `HistoryPatch` (`:35`), `HistorySet` (`:40`);
  - `dedupePage` (`:49`) and `HistoryCtx` (`:63`).
- **Helpers:**
  - `setHistoryState` (internal, `:78`);
  - `clearSupersededMarker` (`:87`) and `canLoadHistory` (`:102`);
  - `waitForHistory` (internal, `:110-128`).
- **Loaders:**
  - `loadOlderPage` (`:130`), `loadPreview` (`:181`), `flushPending` (`:227`), `openHistory` (`:241`);
  - `loadOlder` (`:340`) and `openAtMessage` (`:349`).
  - They use the helpers above.

### Steps
1. **New `packages/client-core/src/store/history-core.ts`:** move `:11-128` unchanged (the constants, the types, `dedupePage`, `HistoryCtx`, `setHistoryState`, `clearSupersededMarker`, `canLoadHistory` and `waitForHistory`), with their comments and the imports they need.
   - Export the two internal helpers (`setHistoryState`, `waitForHistory`) so `history.ts` can use them.
   - It must not import from `./history`.
2. **`history.ts`** imports what it needs from `./history-core` and re-exports every name it exported before, with the same kinds. Do **not** re-export the two formerly internal helpers from `history.ts`.
3. **No behaviour change**, and no importer changes.

### Tests
None new. The client-core store tests and web/phone history tests must pass in the gate.

### Allowed files
- `packages/client-core/src/store/history.ts`
- `packages/client-core/src/store/history-core.ts` (new)
- `work/T-1560-split-client-core-history.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Report gives:**
  - the `wc -l` of both files;
  - the export list of `history.ts` before and after (identical);
  - the gate summary.

---

## Report (written by the worker when done)

### What I did

- Created `packages/client-core/src/store/history-core.ts` (119 lines) with the constants, types and helpers moved unchanged from `history.ts:11-122`: `PREVIEW_HISTORY_MAX`, `PAGE_HISTORY_MAX`, `MESSAGE_JUMP_MAX_PAGES`, `MESSAGE_JUMP_WAIT_MS` (plus the internal `HISTORY_POLL_MS`), `HistoryLoad`, `HistoryState`, `HistoryPatch`, `HistorySet`, `dedupePage`, `HistoryCtx`, `setHistoryState`, `clearSupersededMarker`, `canLoadHistory`, `waitForHistory`. Their comments moved with them.
  - `setHistoryState` and `waitForHistory` are now exported (they were internal) so `history.ts` can import them. `HISTORY_POLL_MS` stays internal.
  - It imports only `effect` (value) and the `./ctx` types (`CoreCtx`, `CorePatch`, `CoreState`) plus the `ChatSummary` type. It imports nothing from `./history`.
- `packages/client-core/src/store/history.ts` (313 lines) imports the helpers it uses from `./history-core` and re-exports every name it exported before, with the same kinds. It does **not** re-export `setHistoryState` or `waitForHistory`.
- The loaders (`loadOlderPage`, `loadPreview`, `flushPending`, `openHistory`, `loadOlder`, `openAtMessage`) are unchanged. No importer changed.
- No behaviour change.

**`wc -l`:** old `history.ts` 399 → new `history.ts` 313 + new `history-core.ts` 119 (both under 400).

**Export list of `history.ts` before and after (identical, 18 names):**

```
HistoryCtx, HistoryLoad, HistoryPatch, HistorySet, HistoryState,
MESSAGE_JUMP_MAX_PAGES, MESSAGE_JUMP_WAIT_MS, PAGE_HISTORY_MAX,
PREVIEW_HISTORY_MAX, canLoadHistory, clearSupersededMarker, dedupePage,
flushPending, loadOlder, loadOlderPage, loadPreview, openAtMessage, openHistory
```

Verified by extracting export names from `git show HEAD:...history.ts` and from the working-tree `history.ts` and comparing: `identical: true` (before 18, after 18).

### Checks run

- `pnpm install` — done (resolved 1251, done in 40.3s; only a pre-existing mobile peer-dependency warning).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/history.test.ts` — Test Files 1 passed, Tests 21 passed.
- `pnpm gate` — GATE PASS, summary lines:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (3.2s)
PASS  format  (1.1s)
PASS  lint  (2.0s)
PASS  typecheck  (7.0s)
PASS  effect  (2.8s)
PASS  tests @zilar/client-core  (19.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

`git status --porcelain` shows only the three Allowed files (modified `history.ts`, modified `work/T-1560-...md`, new `history-core.ts`).

### Notes for the lead

- **Effect ratchet:** `history-core.ts` makes a value import from `effect` (`Effect.sleep`, `Effect.suspend`, …), so it classifies as `effect`, not `needs-effect`. No `// effect-plain:` marker was added, and the gate printed `PASS effect`.
- `setHistoryState` / `waitForHistory` are exported from `history-core.ts` but deliberately not re-exported from `history.ts`, so the barrel's public surface is unchanged (the store `index.ts` `export * from './history'` does not leak them).
- No deviations from the spec.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean; the moved blocks are byte-identical.
- **What the lead checked:**
  - **Sizes:** `history.ts` 313 and `history-core.ts` 119 lines (was 399).
  - **Exports:** `history.ts` re-exports the constants, types and helpers from `./history-core`. `setHistoryState` and `waitForHistory` are only imported, not re-exported, as the spec asked.
  - **No cycle:** `history-core.ts` doesn't import `./history`.
- **Tests:** the client-core and app store tests passed in the worker's gate.

