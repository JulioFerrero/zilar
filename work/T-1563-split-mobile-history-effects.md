---
id: T-1563
title: "Split apps/mobile/src/store/effects/history.ts (399 lines): the core-history adapter (asHistoryState, asMobilePatch, historySet and the historyCtx object) moves to store/effects/history-ctx.ts as makeHistoryCtx(ctx); makeHistory calls it; no behaviour change"
status: merged
milestone: M5
branch: task/T-1563-split-mobile-history-effects
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1563: Split the phone history effects

## Spec (written by Claude, do not edit)

### Why
`apps/mobile/src/store/effects/history.ts` is 399 lines. It is the phone's chat-list merge and history loading (the message pipeline). **Follow `docs/audit/split-rules.md`.** No UI changes, so no phone smoke is needed.

### Facts (the lead read them on main, 2026-10-15)
- **Exports:**
  - the re-export of `MESSAGE_JUMP_MAX_PAGES` and `MESSAGE_JUMP_WAIT_MS` (`:38`);
  - `History` (`:40`);
  - `makeHistory(ctx: StoreCtx)` (`:65`).
- **Inside `makeHistory`, the first part only adapts the store to the core's history modules:**
  - `asHistoryState` (`:71-77`), `asMobilePatch` (`:80-92`) and `historySet` (`:93-105`);
  - the `historyCtx: HistoryCtx` object (`:110-146`, built from `get`, `historySet`, `ctx.coreCtx.*` and `s.*`).
- **The rest** (`loadPrefRows` `:148`, `loadFolders` `:159`, `mergeChatEntries` `:183`, …) uses `historyCtx`.
- **Module-level helpers:** `toCoreLoad` and `toMobileLoad` (`:57-58`).

### Steps
1. **New `apps/mobile/src/store/effects/history-ctx.ts`:** `export function makeHistoryCtx(ctx: StoreCtx): HistoryCtx` holds `asHistoryState`, `asMobilePatch`, `historySet` and the `historyCtx` object, moved **unchanged** (comments included), with `toCoreLoad` and `toMobileLoad` if only they use them. Import the types it needs. It must not import from `./history`.
2. **`history.ts`:** `const historyCtx = makeHistoryCtx(ctx);` in place of the moved block. Keep every export, and remove the imports only the moved code used.
3. **No behaviour change.** The phone store tests must pass in the gate.

### Allowed files
- `apps/mobile/src/store/effects/history.ts`
- `apps/mobile/src/store/effects/history-ctx.ts` (new)
- `work/T-1563-split-mobile-history-effects.md`

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

Split `apps/mobile/src/store/effects/history.ts` along the plan's boundary:

- New `apps/mobile/src/store/effects/history-ctx.ts`: `export function makeHistoryCtx(ctx: StoreCtx): HistoryCtx`.
  It holds `asHistoryState`, `asMobilePatch`, `historySet` and the `historyCtx: HistoryCtx` object, moved **unchanged** with their comments, plus the module-level `toCoreLoad`/`toMobileLoad` helpers (they are used only by the moved code). It imports only types (`HistoryCtx`, `HistoryLoad`, `HistoryPatch`, `HistorySet`, `HistoryState` from `@zilar/client-core/store`; `ChatStoreState`/`LoadState` from `../types`; `StoreCtx` from `./runtime`) and does **not** import from `./history`.
- `history.ts`: the moved block is replaced by `const historyCtx = makeHistoryCtx(ctx);`. Every export (`MESSAGE_JUMP_MAX_PAGES`, `MESSAGE_JUMP_WAIT_MS`, `History`, `makeHistory`) is kept; the imports only the moved code used (`HistoryCtx`, `HistoryPatch`, `HistorySet`, `HistoryState`, `HistoryLoad` from the core, and the `ChatStoreState`/`LoadState` import from `../types`) are removed, and `makeHistoryCtx` is imported from `./history-ctx`. No behaviour change.

### Checks run

- `wc -l`: old `history.ts` = 399; new `history.ts` = 314; new `history-ctx.ts` = 106 (both under 400).
- Exports before/after are identical (`grep -E "^export"`):
  - before (old `history.ts`): `MESSAGE_JUMP_MAX_PAGES, MESSAGE_JUMP_WAIT_MS` re-export; `interface History`; `function makeHistory`.
  - after (barrel `history.ts`): same three; new file exports only `function makeHistoryCtx`.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.history.test.ts`: 1 file passed, 8 tests passed.
- `pnpm gate` (from repo root) summary:

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (2.6s)
PASS  format  (0.9s)
PASS  lint  (1.8s)
PASS  typecheck  (4.6s)
PASS  effect  (1.6s)
PASS  tests @zilar/mobile  (3.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Effect ratchet: no `// effect-plain:` marker was added. `history-ctx.ts` imports `@zilar/client-core/store` types and `../types`/`./runtime` types only (no `effect` value, no Promise edge), so it classifies `plain`; the gate `effect` step printed `PASS`.
- The only importer of `history.ts` is `real-store.ts`, which is unchanged (the barrel keeps every export).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean.
- **What the lead checked:**
  - **Sizes:** `history.ts` 314 and `history-ctx.ts` 106 lines (was 399).
  - **Exports:** the `^export` lines of `history.ts` are identical to main's.
  - **No cycle:** `history-ctx.ts` doesn't import `./history`.
- **Tests:** the phone store tests passed in the worker's gate. No UI changed, so there was no smoke.

