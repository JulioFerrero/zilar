---
id: T-0918
title: "Store core T9: the mobile store on the core polling and lifecycle (boot, connect retry with backoff Q3, resume, stop then reset), tests first"
status: merged
milestone: M5
branch: task/T-0918-store-core-t9-mobile-lifecycle
model: auto
effort: default
depends_on: [T-0915, T-0917]
estimate: 1 day
---

# T-0918: Store core T9, mobile on the core polling and lifecycle

## Spec (written by Claude, do not edit)

### Why
This is task T9 of `docs/STORE_CORE_PLAN.md` (section 6, "T9: mobile on core polling and lifecycle (mobile), live"). Its risk is high: resume, reconnect and sign-out on the phone.

T-0915 (merged) moved polling and the lifecycle into the core, and the web store runs on them:
- `packages/client-core/src/store/lifecycle.ts`: `CONNECT_RETRY_DELAYS_MS` `:37`, `startStore` `:96`, `retryBoot` `:108`, `stopStore` `:118`, `reset` `:135`, `reconnect` `:157`;
- `packages/client-core/src/store/polling.ts`: `startChatsPolling` `:98`, `startPinsPolling` `:104`, the draft turn helpers `:110-130`.

The lead located the mobile code on main on 2026-10-10:
- `apps/mobile/src/store/effects/polling.ts` has 230 lines and `effects/lifecycle.ts` 273;
- `effects/ports.ts` (172 lines) has `AppStateLike` at `:20`;
- `effects/runtime.ts` has 295 lines;
- `apps/mobile/src/store/real-store.ts`: `initialUserState` `:664`, `teardown` `:711`, `ledger.reset()` `:738`, and `start` and `stop` at `:771-772`.

### What to build
1. **Tests first,** in a new file `apps/mobile/src/store/real-store.lifecycle.test.ts`, committed on the old code:
   - what must not change:
     - boot loads chats and contacts;
     - resume after the app comes back to the foreground reconnects and awaits an in-flight boot;
     - sign-out (`stop()`) clears every user-scoped field (T-0901's test in `real-store.sign-out.test.ts` must keep passing unedited);
     - `start()` twice does not boot twice;
   - then a failing commit: a rejected `connect()` retries after 2 s, then 5 s, and so on (Q3 is decided yes; plan section 8).
2. **The move:**
   - `effects/polling.ts` and `effects/lifecycle.ts` become bindings over the core;
   - `AppStateLike` becomes the core `visibility` port;
   - the `Life` adapter in `effects/runtime.ts` goes once nothing uses it;
   - `real-store.ts` start and stop use the core `startStore` and `stopStore`, then `reset`, so sign-out still clears everything;
   - mobile sets `flags.connectRetry: true` and `flags.reconnectOnResume: true`.
3. **T-0915's nit:** make the core `reset()` also clear the finished-turn set (`packages/client-core/src/store/lifecycle.ts:135`), with a core test.
4. **T-0919's follow-up:** mobile `real-store.ts` passes the core ports with an `as unknown as CorePorts` cast. Supply the full ports object, which this task builds anyway, and delete the cast.
5. **Unchanged:** the only behaviour change is the connect retry (R7, Q3). No existing test is edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers, never a raw `setTimeout(resolve, 0)`), `docs/STORE_CORE_PLAN.md` sections 2.3, 3, 6 (T9) and 8, the Reports of `work/T-0901-*.md`, `work/T-0915-*.md` and `work/T-0917-*.md`, `packages/client-core/src/store/{lifecycle,polling,ports,ctx}.ts`, and the mobile store.

### Allowed files
`apps/mobile/src/store/effects/polling.ts`, `apps/mobile/src/store/effects/lifecycle.ts`, `apps/mobile/src/store/effects/ports.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/mobile/src/store/real-store.lifecycle.test.ts`, `apps/mobile/src/store/effects/history.ts` (lead, fix round: folders and prefs wiring at boot), `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/lifecycle.test.ts`, `packages/client-core/src/store/ports.ts` and `packages/client-core/src/store/ctx.ts` (only small additions mobile needs), `work/T-0918-store-core-t9-mobile-lifecycle.md`.

T-0919 moves pins, prefs and folders in parallel: do not touch `apps/mobile/src/store/effects/pins.ts` or `events.ts`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
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
- The Report gives the lines per side and the flags mobile sets.
- Live check for Julio on the emulator: background then foreground, airplane mode on then off (the chat reconnects by itself within about a minute), and sign out then sign in as another user.

---

## Report (written by the worker when done)

**Commits, in order**
1. `be864367`: guards on the old code. New `apps/mobile/src/store/real-store.lifecycle.test.ts`, 5 tests, all passed: boot loads chats and contacts, a resume reconnects a core that is not online, a resume during an in-flight boot waits instead of booting twice, `start()` twice boots once, `stop()` (sign-out) clears the user scoped state.
2. `5ddab169`: the failing expectation, 1 test. A rejected `connect()` retries after `CONNECT_RETRY_DELAYS_MS[0]`; on the old code it failed (`connect` called 1 time, expected 2). Run: 5 passed, 1 failed.
3. `0a7d3fef`: the move onto the core.
4. `9ab50b18`: type the new core test's fiber (gate's typecheck caught `boot?.fiber ?? Effect.never`).

**The move**
- `apps/mobile/src/store/effects/polling.ts` (230 → 17 lines) is now a binding: it re-exports the core poll/draft/constant names.
- `apps/mobile/src/store/effects/lifecycle.ts` (273 → 217) is now the mobile adapter: it builds the core `LifecycleCtx` (the `HistoryCtx` shape plus `DraftTurns` and the lifecycle fields), maps the mobile `historyLoad`/`'loaded'` names to the core `historyState`/`'ready'`, supplies the `StoreAppHooks` (status, boot write, media hosts, `joinGroups`, refreshes, `applyStop`), and exposes `start()` = core `startStore`, `stop()` = core `stopStore` then core `reset`, `restartBoot()` = core `retryBoot`, `finishDraftTurn()`.
- `apps/mobile/src/store/effects/ports.ts` (+22): `AppStateLike` also yields the core `visibility` port (`isVisible` + `onFocus` = AppState becoming `active`) and `isVisible`. `appState` stays because the draft stream subscribes to it.
- `apps/mobile/src/store/effects/runtime.ts` (+39/−42): `StoreState` gains `finishedTurns`/`finishedTurnOrder`; `Life` is reimplemented over the shared core lifetime (`generation()` is the lifetime's current session, nothing is created at construction) and keeps every method so `runtime.test.ts` passes unedited; the `StoreHelpers` fields the old lifecycle/polling used (`flushPending`, `isVisible`, `startDraftStream`, `startTopicsPolling`, the `handle*` listeners) are gone; `StoreFx` gains `scheduleChatsRefresh` and `refreshActiveChatPins`.
- `apps/mobile/src/store/real-store.ts` (+53/−37): builds the full `CorePorts` object (item 4), fixes `coreCtx.ports`, uses `lifecycle` for start/stop/restartBoot/finishDraftTurn, drops the now-unused life helpers, and `teardown()` now clears `status`/`mediaTrustedHosts`/`pinsPollEnabled`/the core handle.

**The flags mobile sets** (`corePorts.flags` in `real-store.ts`): `{ connectRetry: true, reconnectOnResume: true }`.

**Behaviour change: R7 only (Q3 = yes).** A rejected `connect()` now retries on the core ladder 2 s, 5 s, 15 s, 30 s, 60 s instead of staying offline until the next resume. R8 (resume) keeps its behaviour, now driven by the core `reconnect` off `ports.visibility.onFocus`. R9 (`start()` twice) was already idempotent; R10 `stop()` keeps the ledger and mobile's sign-out is `stopStore()` + `reset()` + `teardown()` (T-0901's test passes unedited).

**Core changes (T-0915's area)**
- Item 3: core `reset()` now calls `clearFinishedTurns(ctx)`; new core test "reset also clears the finished-turn memory".
- Required fix, not in the spec list (say so): `LifecycleBoot`'s `fiber` is now clearable and `ctx.boot` is cleared when the boot settles (new `beginBoot`). Without it, a completed boot left `ctx.boot` set forever, so the core `reconnect` always took the "await the in-flight boot" branch and never reconnected a dropped core — mobile's resume would stay offline. New core test "clears the in-flight boot once it settles, so a resume can reconnect". Web leaves `reconnectOnResume` off, so web is unchanged.

**Deviations from the spec (with reasons)**
- **The `Life` adapter stays (reduced), it does not go.** `effects/events.ts` and `effects/history.ts`, both outside the Allowed files, still use `life.forkKeyed`/`life.cancel`/`life.generation()`. I reimplemented `Life` over the one shared core lifetime so there is a single session owner, and kept the method set so `runtime.test.ts` passes unedited. Removing it needs those two files.
- **Item 4's cast does not exist on this branch.** At HEAD, mobile `coreCtx.ports` was the T6 `{ now, isVisible, storage }` object, which no longer satisfied the T-0915 `CorePorts`: `pnpm --filter @zilar/mobile exec tsc --noEmit` was already red at `real-store.ts(494,7)`. I supplied the full `corePorts` object and wired it; there was no `as unknown as CorePorts` to delete.
- **The failed-connect core handle is kept in mobile state.** The core clears `ctx.core` when the connect attempt Scope closes; mobile's `reloadChats`/adoption path (`history.ts`, outside this task) branches on `state.core`, and `real-store.general-only.test.ts` expects adoption to run after a failed connect. The adapter's `core` setter ignores `undefined`, and `teardown()` clears it on sign-out.
- **Pins poll.** The core owns the poll (started at boot, reads `activeChatId`). Mobile's per-open-chat `stopPinsPoll()` now flips a mobile flag (`pinsPollEnabled`) that `fx.refreshActiveChatPins` reads, so `real-store.prefs-pins.test.ts` "stops the pins poll when leaving the chat" still passes.

**Lines per side** (`git diff --numstat main...HEAD`)
- Mobile source: +317 / −551 (`effects/lifecycle.ts` +186/−242, `effects/polling.ts` +17/−230, `effects/ports.ts` +22, `effects/runtime.ts` +39/−42, `real-store.ts` +53/−37).
- Core source: +27 / −4 (`lifecycle.ts`).
- Tests: mobile `real-store.lifecycle.test.ts` +193 (new, 6 tests); core `lifecycle.test.ts` +45/−1 (2 new cases, no existing case changed).

**Checks (real results)**
- Guards on the old code: 5 passed. With the retry test: 5 passed, 1 failed (`connect` 1 vs 2).
- Mobile `src/store`, 3 runs: 336 passed, 1 skipped each (35 files passed, 1 skipped).
- `@zilar/client-core` store tests: 134 passed (12 files).
- `@zilar/web` `src/store` tests: 241 passed (21 files).
- `pnpm gate` (repo root): `gate: 9 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/client-core`, `PASS tests @zilar/mobile`; `scope: every changed file is inside the Allowed files`; `GATE PASS`. (The first gate run failed only the new core test's typecheck; fixed in `9ab50b18`.)

**Unsure / notes**
- Mobile keeps no last-read map (`CorePorts.storage = null`), so `lastReadUserId` stays unused; unchanged.
- `coreCtx.fx.finishDraftTurn` now delegates to `lifecycle.finishDraftTurn`; the core's incoming path runs on the lifecycle context, so this is the same implementation.

**Live check for Julio (emulator):** background then foreground (chat stays connected / reconnects), airplane mode on then off (the chat reconnects by itself within about a minute without a manual resume), and sign out then sign in as another user (no state leaks).

**Round 1 (fix review, `PREREVIEW.md`)**
- Finding 1 (must-fix), stale-core resume: `effects/lifecycle.ts` now keeps the core's handle in a private `lifecycleCore`, separate from `s.core`. The lifecycle setter records every assignment, including the `undefined` a closed attempt writes (`packages/client-core/src/store/lifecycle.ts:372-381`), so `reconnect` sees no core after a failed connect and boots fresh instead of calling `connect()` on a listener-less one. `s.core` still keeps the last handle for the `effects/history.ts` adoption/preview path. New test `a resume after a failed connect boots a fresh core, not the deaf stale one`: verified it fails on the old getter (`expected ... to be called 2 times, but got 1 times`) and passes after.
- Finding 2 (should-fix), retry test: it now imports `CONNECT_RETRY_DELAYS_MS` from `@zilar/client-core/store` (local copy deleted) and advances/asserts the second rung (2 s → still `offline`, then 5 s → `online`).
- Nits 3 and 4: not touched (neither line is changed this round).
- Tests: `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.lifecycle.test.ts` → 1 file, 7 passed.
- `pnpm gate` (repo root): `gate: 9 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/client-core`, `PASS tests @zilar/mobile`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.

**Round 2 (phone bug: the folder chips are missing)**
- **Bug:** after the move, mobile's boot no longer ran its own folder load, so `foldersLoaded` stayed false and only "All chats" showed (the "Personal"/"AIs" chips came from `state.folders`).
- **Prefs still load:** the core boot fetches them through `CoreApi.listChatPrefs` (`real-store.ts` maps it to `ports.chatPrefs.listChatPrefs`) and `applyBoot` writes `s.chatPrefRows` and applies them to the chats. The new test's pref assertions pass on the pre-fix code; the failing run stopped at the folder assertion (`folders` was `[]`).
- **Fix (commit 2):** added an optional `loadFolders` hook to the core `StoreAppHooks` (`packages/client-core/src/store/ctx.ts`), called it in the core `boot` beside the other fire-and-forget boot work (`packages/client-core/src/store/lifecycle.ts`), and mobile implements it as `ctx.forkSession(ctx.fx.loadFolders)` (`apps/mobile/src/store/effects/lifecycle.ts`). Web fetches folders outside the store, so the hook is optional and web is unchanged. `effects/history.ts` needed no edit: `ctx.fx.loadFolders` already bridges to `history.loadFolders`.
- **Prefs not re-wired on purpose:** adding `loadPrefRows` beside the core's own fetch would send a second `listChatPrefs` GET at every boot; the test pins the single call.
- **Other old-mobile-boot steps checked, all still done by the core boot:** `getMe`/`getChats`/`getContacts`; prefs load + apply (`applyBoot`); last-read (`readLastRead`, `storage: null` → `{}`); `rememberGroupIds`; `me`/`currentUserId`/`chats`/`contacts`/`chatsLoad`; `startDraftStream`; `flushPending`; token + media hosts; connect/subscribe; resume flush; `joinGroups` + `groupsJoined`; per-chat `loadPreview` + `sortByRecency`; `saveChatList`. The old `startTopicsPolling` is now the core `startChatsPolling` (60 s + focus `refreshChats`). Only `ownedAis` is no longer re-written at boot: it is set once at store creation from `ports.ownedAis ?? []` and the deps are static, so nothing changed.
- **Tests:** `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store` 3× → `38 passed | 1 skipped` files (39), `357 passed | 1 skipped` tests (358). `@zilar/client-core` → 17 files, 170 passed. Typechecks (`@zilar/mobile`, `@zilar/client-core`, `@zilar/web`) clean. `prettier --check` + `oxlint` on the changed files clean.

## Review (written by Claude)

**Lead, 2026-10-10: approved. Clean after 1 automatic round, with 3 nits.**
- **The move:** mobile polling (230 → 17 lines) and the lifecycle run on the core.
  - Mobile sets `{ connectRetry: true, reconnectOnResume: true }`.
  - Sign-out is `stopStore` then `reset`, and T-0901's test passes unedited.
  - Core `reset()` now also clears the finished turns.
- **Tests first:** 5 guards, then the failing retry expectation.
- **Behaviour:** R7 only, as Q3 decided: a failed connect retries on the 2, 5, 15, 30, 60 s ladder.
- **Round 1:** a resume after a failed connect boots a fresh core.
- **Nits for later:**
  - the dead `firstToken` and `boot` fields on mobile `StoreState`;
  - core `lastReadUserId` is not cleared on `reset`;
  - an unobservable guard in `reconnect`.
- **Note:** T-0919's `as unknown as CorePorts` cast was not on this branch, which already supplies the full ports. When main merges in, keep this branch's full `corePorts` and drop the cast.
- **Check:** the combined check passes, and the lead runs the phone smoke.
- **Live check for Julio on the emulator:**
  - background, then foreground;
  - airplane mode on, then off: the chat reconnects by itself within about a minute;
  - sign out, then sign in as another user.
- **Lead fix round (folders):**
  - the first phone smoke showed only the "All chats" chip, because the new boot no longer loaded the chat folders;
  - fixed tests first (`04701328` failing, `260e3884` fix);
  - the re-run smoke shows all three chips and the chat list.

