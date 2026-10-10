---
id: T-0917
title: "Store core T7b: the mobile store on the core history (first page, older pages, open at message), with the loadOlder overlap fix, tests first"
status: merged
milestone: M5
branch: task/T-0917-store-core-t7b-mobile-history
model: auto
effort: default
depends_on: [T-0912, T-0914]
estimate: 1 day
---

# T-0917: Store core T7b, mobile on the core history

## Spec (written by Claude, do not edit)

### Why
This is the history half of task T7 in `docs/STORE_CORE_PLAN.md` (section 6).
- **T-0912 (merged)** moved web history into `packages/client-core/src/store/history.ts` (357 lines), which de-duplicates an older page by message id.
- **T-0914 (merged)** moved mobile incoming events, actions and reads onto the core.

Mobile has the overlap race T-0912 fixed on web. The lead located it on main on 2026-10-10:
- `apps/mobile/src/store/effects/history.ts` (524 lines): `loadOlderPage` at `:356`, `loadOlder` at `:396-401`, and another caller at `:463`. T-0912 also cited the boot preview cursor at `:157` and the merge without de-duplication at `:385`; re-check those two.
- `apps/mobile/src/components/chat/message-list.tsx:366-367`: scrolling near the top calls `loadOlder`.

Names differ between the apps. Mobile has `historyLoad` with `'loading' | 'loaded' | 'error'` (`apps/mobile/src/store/real-store.ts:487-504`: `setHistoryLoad`, `clearSupersededMarker`). The core uses `historyState` with `'ready'`, as T-0912's Report says.

### What to build
1. **Tests first,** in a new file `apps/mobile/src/store/real-store.history.test.ts`:
   - committed on the old code, what must not change: the first page, older pages until complete, open at a message (jump from search), and the topic-gone case;
   - then a failing commit: `loadOlder` during the first page load ends with each message exactly once, in order, whichever page lands first.
2. **The move:**
   - `effects/history.ts` becomes a binding over the core `history.ts`. Keep `loadPrefRows`, `loadFolders`, `reloadChats` and `jumpTarget` as adapter code, as plan T7 says.
   - `real-store.ts` drops `setHistoryLoad` and `clearSupersededMarker` if the core owns them.
   - Map mobile's `historyLoad`/`'loaded'` to the core's names with the smallest adapter. Do not rename the mobile state the screens read (`historyLoad`) in this task; screens are out of scope.
3. **Unchanged:** the only behaviour change is the overlap fix. No existing test is edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` section 6 (T7), the Reports of `work/T-0912-store-core-t6b-history.md` and `work/T-0914-store-core-t7a-mobile-incoming.md`, `packages/client-core/src/store/history.ts` with its test, and `apps/mobile/src/store/effects/history.ts` with its test.

### Allowed files
`apps/mobile/src/store/effects/history.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.history.test.ts`, `packages/client-core/src/store/history.ts` (only small, tested additions mobile needs; say why), `packages/client-core/src/store/history.test.ts` (new cases only), `work/T-0917-store-core-t7b-mobile-history.md`.

T-0916 removes a small wrapper at `real-store.ts:548-557` in parallel. Do not touch it. T-0915 changes the web store and core `ports.ts` and `ctx.ts`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the mobile `src/store` tests 3 times. The lead runs the phone smoke.

### Acceptance
- The Checks pass, 3 runs.
- The test commits come before the move.
- No existing test is edited.
- The Report gives the lines per side and the name mapping.
- Live check for Julio: on the phone, open a long chat and scroll up right away; each message shows once, in order.

---

## Report (written by the worker when done)

**Commits, in order**
1. `0534da70`: guards on the old code. New `apps/mobile/src/store/real-store.history.test.ts`, 5 tests, all passed: the first page (newest 50, `historyLoad` `loaded`, `hasMore`, `markDisplayed`, preview), older pages 50 at a time until complete, open at a message (`openAtMessage` pages back to `ana-3` of 120 and sets `jumpTarget`), `message_not_found` once history runs out, and a topic that disappears while open moves back with the name-free notice.
2. `1016f34d`: the failing expectations, 2 tests, both failed on the old code:
   - `loadOlder` right after `openChat`, first page landing first: 51 unique for 100 shown;
   - the same with the older page landing first (first page gated): after the next page, `ana-9` shown twice (61 for 60).
3. `4f250088`: the move onto the core. No existing test edited.
4. `405bae62`: prettier on the new test file (the gate's format step caught it).

**The move**
- `apps/mobile/src/store/effects/history.ts` (524 → 384 lines) is now a binding over the core `history.ts`. It keeps `loadPrefRows`, `loadFolders`, `mergeChatEntries`, `fetchChatList`, `refreshChats`, `reloadChatsList`, `adoptChatEntries` and the mobile `openChat` side effects (active chat, pins, group members/detail), as plan T7 says. The first page, older pages, preview, pending open and `openAtMessage` are the core functions, run through a `HistoryCtx` built in `makeHistory` over `ctx.coreCtx` and the mobile `get`/`set`.
- `loadPreview` → core `loadPreview`; `flushPending` → core `flushPending`; `loadOlder` → core `loadOlder`; `retryHistory` → core `openHistory` forked into the session; `openAtMessage` → core `openAtMessage`, then `set({ jumpTarget })` on success (the core does not touch mobile's `jumpTarget`).
- `real-store.ts` (788 → 767 lines) drops `setHistoryLoad` and `clearSupersededMarker`; `StoreHelpers` in `runtime.ts` drops both.
- Core: `MESSAGE_JUMP_MAX_PAGES` and `MESSAGE_JUMP_WAIT_MS` in `history.ts` went from module-private to exported, so the mobile re-export and `effects/history.test.ts`'s timer test use the one cap the core actually applies. No behaviour change.

**Name mapping (lines per side)**
- mobile `historyLoad` (`apps/mobile/src/store/types.ts:163`, `'loading' | 'loaded' | 'error'`) ↔ core `historyState` (`packages/client-core/src/store/history.ts:28`, `'loading' | 'ready' | 'error'`); `'loaded'` ↔ `'ready'`, the other two names are the same. The screens keep reading `historyLoad`; the adapter maps both directions.
- mobile `s.cursors` / `s.loadingHistory` / `s.loadingOlder` / `s.groupsJoined` / `s.pendingOpenChatId` (`effects/runtime.ts:128-138`) ↔ the same `HistoryCtx` fields (`history.ts:43-56`); the `historyCtx` getters/setters read and write the one `StoreState`.
- mobile `real-store.ts:487-506` (`setHistoryLoad` + `clearSupersededMarker`) → core `setHistoryState` + `clearSupersededMarker` (`history.ts:58-80`), used through the adapter's `set` (identity-return skip preserved).

**The overlap fix:** it is the core's, unchanged: `loadOlderPage` drops a page message already in the chat by id (`history.ts:129-146`, `k.sameMessage`), the fix T-0912 landed. Mobile no longer merges an older page itself, so the race closes whichever page lands first.

**Behaviour differences:** none visible. The only change is the overlap fix (each message once, in order).

**Lines per side** (`git diff --numstat main...HEAD`)
- Mobile source: +127 / -288 (`effects/history.ts` +121 / -261; `real-store.ts` +4 / -25; `effects/runtime.ts` +0 / -2).
- Core source: +2 / -2 (`history.ts`, the two `export`s).
- Mobile tests: +273 (the new file). No existing test touched.

**Checks (the task's Checks, run once by `pnpm gate` unless noted)**
- Mobile `src/store` tests, 3 runs: 330 passed, 1 skipped each (323 before this task + 7 new). The new file alone: 7 passed.
- `pnpm gate` (repo root), after one format fix:
  - `gate: 6 changed file(s) against main`
  - `PASS install (frozen)` 3.7s
  - `PASS format` 1.6s
  - `PASS lint` 1.6s
  - `PASS typecheck` 6.2s
  - `PASS effect` 1.9s
  - `PASS tests @zilar/client-core` 3.8s
  - `PASS tests @zilar/mobile` 19.4s
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- Both gate rounds listed `scope: every changed file is inside the Allowed files` (the first failed only on the new test file's formatting).

**Unsure / notes**
- `historyCtx.rt` is the core lifetime (`ctx.coreCtx.rt`), so core `loadOlder`/`flushPending` fork into the store scope, not mobile's session `forkSession`. I judged this equivalent: mobile restarts a generation only on `start()` and `restartBoot()`, and `restartBoot` only runs when `s.core` is undefined, so no history load can be in flight then; `stop()` closes the store scope and interrupts both. This is the `ctx.rt` the core already uses for incoming/actions after T-0914.
- `asHistoryState` builds a fresh `HistoryState` on every `get()`. The core's `clearSupersededMarker` "return the same object to skip" convention is kept by comparing the updater's result to that object.
- The core files are unchanged otherwise; the only core edit is the two `export`s.

**Live check for Julio (phone):** open a long chat and scroll up right away — each message shows once, in order; also jump to a message from search.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no findings.**
- **The move:** mobile history runs on the core `history.ts`. `effects/history.ts` went from 524 to 384 lines, and `real-store.ts` drops `setHistoryLoad` and `clearSupersededMarker`.
- **Names:** mobile's `historyLoad`/`'loaded'` maps to the core's `historyState`/`'ready'` through the adapter, and the screens are unchanged.
- **Tests first:** 5 guards, then the failing overlap expectations, then the move.
- **Behaviour:** the only change is the fix: each message shows once, in order, whichever page lands first.
- **Phone smoke:** a cold-boot run showed "Loading…". A warm re-run and main both show the chat list.
- **Check:** the combined check passes.
- **Live check for Julio:** on the phone, open a long chat, scroll up right away, and jump to a message from search.
