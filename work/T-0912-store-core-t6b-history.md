---
id: T-0912
title: "Store core T6b: web history (first page, older pages, open at message) in packages/client-core, tests first, with the loadOlder overlap fix"
status: merged
milestone: M5
branch: task/T-0912-store-core-t6b-history
model: auto
effort: default
depends_on: [T-0907]
estimate: 1 day
---

# T-0912: Store core T6b, history

## Spec (written by Claude, do not edit)

### Why
This is the history half of task T6 in `docs/STORE_CORE_PLAN.md`. T-0907 moved incoming events, message actions and reads into `packages/client-core/src/store/`, and split history off under the plan's 800-line rule.

T-0907 also found a bug that is on main. If `loadOlder` runs while a chat's first history page is still loading, it pages back from the boot preview's cursor and does not de-duplicate the overlap: a probe with 60 messages gave 100 bubbles for 51 unique ids. The code is `apps/web/src/store/effects/history.ts`: `loadOlderPage` at `:72`, `loadOlder` at `:246-251` and its other caller at `:328`. The file has 496 lines.

The plan's section 7 also lists two `loadOlder` calls at once as uncovered.

### What to build
1. **Tests first,** in a new file `apps/web/src/store/realStore.history.test.tsx`, committed on the old code:
   - **What must not change:** the first page, older pages until complete, open at a message (jump from search), and the topic-gone case.
   - **New expectations, failing on the old code** (one commit):
     - `loadOlder` during the first page load ends with each message exactly once, in order;
     - two `loadOlder` calls at once fetch one page, not two.
2. **Core:** a new `packages/client-core/src/store/history.ts` with its test, on the ctx and ports that T-0907 created (`packages/client-core/src/store/ctx.ts` and `ports.ts`), plus a line in the T6 section of `index.ts`. Fix the overlap: do not page from a preview cursor while the first page is in flight, or de-duplicate by message id on merge; say which.
3. **Web:** `apps/web/src/store/effects/history.ts` becomes a binding over the core, or is deleted. `realStore.ts` keeps its facade.
4. **Mobile:** check whether mobile's `apps/mobile/src/store/effects/history.ts` has the same overlap race. Write the answer with `file:line` in the Report; do not change mobile, because T7 carries it.
5. **Unchanged:** everything else in behaviour, and the existing tests.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0912/`; use the `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 4, 6 (T6) and 7, the Report of `work/T-0907-store-core-t6-incoming-history.md`, `packages/client-core/src/store/*`, and `apps/web/src/store/effects/history.ts` with its test.

### Allowed files
`packages/client-core/src/store/history.ts`, `packages/client-core/src/store/history.test.ts`, `packages/client-core/src/store/index.ts` (T6 section only), `packages/client-core/src/store/ctx.ts` and `packages/client-core/src/store/ports.ts` (only what history needs), `apps/web/src/store/effects/history.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.history.test.tsx`, `work/T-0912-store-core-t6b-history.md`.

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
Run the `realStore*.test.tsx` files and `effects/history.test.ts` 3 times.

### Acceptance
- The Checks pass, 3 runs.
- The test commits come before the move.
- No existing test is edited.
- The Report gives the lines per side, the overlap fix, and the mobile verdict.
- Live check for Julio: on web, scroll back in a long chat right after opening it, and jump to a message from search.

---

## Report (written by the worker when done)

**Commits, in order**
1. `76be2681`: tests on the old code. New `apps/web/src/store/realStore.history.test.tsx`, 5 tests, all passed on the old code: the first page (newest 50, ready, `hasMore`, marked displayed, preview), older pages 50 at a time until complete, open at a message (pages back to `ana-3` of 120), `message_not_found` once history runs out, and a topic that disappears while open moves to General with the notice.
2. `0ea83778`: the new expectations, 3 tests, all 3 failed on the old code:
   - `loadOlder` right after `openChat`, first page landing first: got 100 bubbles for 51 ids (the T-0907 probe);
   - the same with the older page landing first (first page held back): the next page duplicated `ana-9` (61 for 60);
   - two `loadOlder` calls at once during the first page load: one older fetch, but the overlap duplicated. **Unsure/honest:** the "one page, not two" half already held on the old code (the `loadingOlder` guard, and `realStore.incoming.test.tsx` covers it after the first page); the test failed on the de-dup half.
3. `c12173d9`: the move and the fix. No existing test edited.

**Core (`packages/client-core/src/store/`)**
- New `history.ts`: `PAGE_HISTORY_MAX`, `PREVIEW_HISTORY_MAX`, `canLoadHistory`, `clearSupersededMarker`, `loadOlderPage`, `loadPreview`, `flushPending`, `openHistory`, `loadOlder`, `openAtMessage`, moved as they were.
- `HistoryCtx` (extends `CoreCtx`) and `HistoryState`/`HistoryPatch`/`HistorySet` are declared in `history.ts`: the state adds `status`, `historyState`, `historyComplete` and `openChat`; the ctx adds `groupsJoined`, `pendingOpenChatId`, `cursors`, `loadingHistory`, `loadingOlder`. `ctx.ts` and `ports.ts` are **unchanged**, so no conflict with T-0914.
- New `history.test.ts`, 15 tests. One line in the T6 section of `index.ts`.

**The overlap fix: de-duplicate by message id on merge.** `loadOlderPage` now drops a page message that is already in the chat (`k.sameMessage`, the same alias-aware check the first page uses) and keeps the loaded copy. I did not gate `loadOlder` on the first page: the de-dup fixes both arrival orders (the first page can land before or after the overlapping page, and the cursor can move forward to the first page's oldest id), and a gate would silently drop the user's scroll request.

**Web**
- `effects/history.ts` keeps `openChat`, `scheduleChatsRefresh`, `refreshChats` and `refreshChatsOrThrow` (verbatim) and re-exports the moved functions, so `lifecycle.ts`, `groups.ts`, `realStore.ts` and `effects/history.test.ts` import them unchanged.
- `effects/ctx.ts`: `StoreCtx extends HistoryCtx`; the five history fields moved to `HistoryCtx`.
- `realStore.ts`: unchanged.
- **Left behind (not an Allowed file):** `effects/constants.ts:4-5` still exports `PREVIEW_HISTORY_MAX` and `PAGE_HISTORY_MAX`, now unused; the core has its own. A follow-up can delete them.

**Lines per side** (`git diff --numstat --no-renames main HEAD`)
- Core source: +358 (history 357, index 1). Core tests: +278.
- Web source: +26 / -312 (history +20 / -299, ctx +6 / -13). Web tests: +245 (the new file).

**Behaviour differences:** one, the fix: an older page no longer adds a message that is already shown. Nothing else.

**Mobile verdict: yes, the same race.** `apps/mobile/src/store/effects/history.ts:157` sets the cursor from the boot preview; `loadOlder` at `:396-402` pages from it with no first-page check; `loadOlderPage` merges at `:385` (`h.sortMessages([...withEditsApplied, ...h.listFor(state, chatId)])`) with no de-dup. The trigger is `apps/mobile/src/components/chat/message-list.tsx:366-367` (scroll near the top while `hasMore`). Not changed; T7 gets the fix by moving onto the core. Note for T7: mobile names its load state `historyLoad` with `'loaded'`, not `historyState`/`'ready'`, so it does not fit `HistoryState` as is.

**Checks** (wave mode, no `pnpm gate`)
- `pnpm --filter @zilar/client-core exec vitest run --reporter=dot`: 10 files, 117 passed (102 before plus 15 new).
- `pnpm --filter @zilar/web exec vitest run --reporter=dot src/store`: 19 files, 236 passed.
- `pnpm --filter @zilar/web exec vitest run --reporter=dot`: 189 files, 1942 passed.
- All seven `realStore*.test.tsx` files plus `effects/history.test.ts`, 3 runs: 193 passed each time. Core `history.test.ts`, 3 runs: 15 passed each time.
- `pnpm --filter @zilar/client-core typecheck`, `@zilar/web typecheck`, `@zilar/mobile typecheck`: clean.
- `prettier --check` and `oxlint` on every changed file: clean.

**Live check for Julio (web):** open a long chat and scroll back at once (each message once, in order); jump to a message from search.

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **The move:** web history is in `packages/client-core/src/store/history.ts`, with 15 core tests. Web `effects/history.ts` loses about 280 lines.
- **Tests first:** 5 guards, then 3 failing expectations, then the move.
- **Bug fixed:** `loadOlderPage` de-duplicates by message id whichever page lands first. It keeps the user's scroll rather than ignoring it, and this is the only behaviour change.
- **Mobile has the same race,** at `apps/mobile/src/store/effects/history.ts:157,385,396-402`. T7b carries the fix.
- **Follow-ups:**
  - delete the unused `PREVIEW_HISTORY_MAX` and `PAGE_HISTORY_MAX` in `apps/web/src/store/effects/constants.ts:4-5`;
  - mobile's `historyLoad`/`'loaded'` naming against the core's `historyState`/`'ready'` is for T7b.
- **Check:** the combined check passes.
- **Live check for Julio:** on web, scroll back right after opening a long chat, then jump to a message from search.
