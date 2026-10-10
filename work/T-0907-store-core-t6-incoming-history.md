---
id: T-0907
title: "Store core T6: incoming events, message actions, reads and history in packages/client-core, the web store on them, tests first"
status: todo
milestone: M5
branch: task/T-0907-store-core-t6-incoming-history
model: auto
effort: default
depends_on: [T-0903, T-0904]
estimate: 1.5 day
---

# T-0907: Store core T6, incoming, actions and history

## Spec (written by Claude, do not edit)

### Why
This is task T6 of `docs/STORE_CORE_PLAN.md` (section 6, "T6: incoming, message actions and history in core (core + web), tests first"). Follow it exactly. Its risk is medium-high, because of send echo matching and paging.

Changes since the plan was written:
- **Tests T-0904 already added.** `apps/web/src/store/realStore.ledger.test.tsx` covers:
  - an echo before `sendMessage` resolves (DM and group, both orders);
  - two identical texts in a row;
  - the echo of a reply.

  Do not write those again. Your tests-first file still needs the typing line clearing after 5 s and on `paused`, plus any gap you find in incoming, actions, reads or history.
- **The `ChatMessage` type.** T-0904 declared its own `LedgerStanza` type in `packages/client-core/src/store/ledger.ts`, because importing `ChatMessage` from `@zilar/xmpp-core` broke the client-core typecheck (the `@xmpp/client` type declarations are included only in the apps' tsconfigs). In this task, add that include to `packages/client-core/tsconfig.json`, and switch the core to `ChatMessage`.
- **Lines.** Re-check the plan's line numbers (`realStore.ts:1207-1314`, the ctx wiring) against the file. T-0904 cut `realStore.ts` from 1,550 lines to 479, so they have moved.

### What to build
1. **Tests first,** in a new file `apps/web/src/store/realStore.incoming.test.tsx`, committed on the old code. It covers the typing-line cases and any gap you find, as described above.
2. **Core:** new `ctx.ts`, `ports.ts`, `reads.ts`, `incoming.ts`, `actions.ts` and `history.ts`, with their tests, in `packages/client-core/src/store/`, plus their lines in the T6 section of the index.
   - The ports follow plan section 4.
   - The core uses `makeLifetime` (T2) and the ledger (T3).
3. **Web:** `apps/web/src/store/effects/incoming.ts`, `messageActions.ts`, `history.ts` and `reads.ts` become bindings over the core, or are deleted. `effects/ctx.ts` and `effects/ports.ts` build the core ports from `RealStoreDeps`. `realStore.ts` keeps its facade.
4. **Split rule:** if the diff passes about 800 lines, stop after incoming plus actions plus reads, report, and the lead will chain history as its own task.
5. **Unchanged:** behaviour on web, and the existing tests.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0907/`; use `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 2 to 7, `packages/client-core/src/store/*`, the Reports of `work/T-0903-*.md` and `work/T-0904-*.md`, and `apps/web/src/store/` (`realStore.ts`, `effects/*`).

### Allowed files
`packages/client-core/src/store/**`, `packages/client-core/tsconfig.json`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/effects/incoming.ts`, `apps/web/src/store/effects/messageActions.ts`, `apps/web/src/store/effects/history.ts`, `apps/web/src/store/effects/reads.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/effects/ports.ts`, `apps/web/src/store/effects/*.ts` (only imports of moved code), `apps/web/src/store/realStore.incoming.test.tsx`, `work/T-0907-store-core-t6-incoming-history.md`.

T-0906 edits mobile files and `packages/client-core/src/store/ledger.ts` in parallel. Do not change `ledger.ts` except for the `ChatMessage` switch, and keep that edit minimal.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the `realStore*.test.tsx` files and `effects/history.test.ts` 3 times. The guards are listed in plan T6.

### Acceptance
- The Checks pass, 3 runs.
- The tests-first commit comes before the move.
- No existing test is edited.
- The Report gives the lines per side, and either "no behaviour change" or the list of changes.
- Live check for Julio: on web, receiving messages, typing indicators, read marks, opening an old chat and scrolling back, and jumping to a message from search.

---

## Report (written by the worker when done)

## Review (written by Claude)
