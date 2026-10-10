---
id: T-0915
title: "Store core T8: polling, drafts and lifecycle (boot, connect with retry, resume, stop/reset) in packages/client-core, the web store on them, tests first"
status: merged
milestone: M5
branch: task/T-0915-store-core-t8-lifecycle
model: auto
effort: default
depends_on: [T-0912]
estimate: 1.5 day
---

# T-0915: Store core T8, polling, drafts and lifecycle

## Spec (written by Claude, do not edit)

### Why
This is task T8 of `docs/STORE_CORE_PLAN.md` (section 6, "T8: polling, drafts and lifecycle in core (core + web), live"). Follow it. Its risk is high: connect, reconnect and resume.

The lead re-checked the web lines on main on 2026-10-10:
- `apps/web/src/store/effects/lifecycle.ts` has 355 lines:
  - the `pagehide` listener is at `:92-93`;
  - `retryBoot` at `:99`;
  - `signOutStore` at `:122`;
  - the retry delay pick at `:244-245`, using `CONNECT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000]` (`apps/web/src/store/effects/constants.ts:12`);
  - the XMPP attempt Scope `Scope.fork(session.scope)` at `:321`;
  - `connect()` at `:336`.
- `apps/web/src/store/effects/polling.ts` has 199 lines, `effects/ports.ts` 326 and `realStore.ts` 500.

T-0907 and T-0912 already created `packages/client-core/src/store/ctx.ts`, `ports.ts`, `incoming.ts`, `actions.ts`, `reads.ts` and `history.ts`.

### What to build
1. **Tests first,** in a new file `apps/web/src/store/realStore.lifecycle.test.tsx`, committed on the old code:
   - a rejected `connect()` that retries on the delay ladder (nothing covers the reject branch after `:336` today);
   - `start()` called twice without `stop()`;
   - sign-out still resets and reloads, as T-0901 verified for web.
2. **Core:** new `packages/client-core/src/store/polling.ts` and `lifecycle.ts` with tests, plus their lines in a T8 section of `index.ts`. `ports.ts` gains `visibility`, `drafts`, `notifications` and `flags`, as plan section 4 sketches.
   - The XMPP attempt Scope stays.
   - Mobile's "await the in-flight boot on resume" joins behind `flags.reconnectOnResume`.
   - `start()` becomes idempotent (R9).
   - `stop()` keeps the ledger and `reset()` clears it (R10). Check this against T-0901's mobile sign-out fix, which made mobile `stop()` reset all user state. The core must let mobile keep that behaviour: mobile can call `stop()` then `reset()` on sign-out. Say how in the Report.
   - `flags.connectRetry` defaults to true (Q3 is decided yes, plan section 8).
3. **Web:**
   - `effects/polling.ts` and `effects/lifecycle.ts` become bindings. `signOutStore`, the cached paint and `pagehide` stay as adapter code.
   - `effects/ports.ts` gains the focus/visibility adapter.
   - `realStore.ts` start and stop go through the core.
   - Facades stay.
4. **Behaviour on web:** R9 and R10 only, each listed in the Report. Nothing else changes.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/T-0915/`; use `@/test/wait` helpers), `docs/STORE_CORE_PLAN.md` sections 2.3, 3, 4, 6 and 8, the Reports of `work/T-0901-*.md`, `work/T-0907-*.md` and `work/T-0912-*.md`, `packages/client-core/src/store/*`, and the web store.

### Allowed files
`packages/client-core/src/store/polling.ts`, `packages/client-core/src/store/lifecycle.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/*.test.ts` (new files or new cases), `packages/client-core/src/store/index.ts` (T8 section only), `apps/web/src/store/effects/polling.ts`, `apps/web/src/store/effects/lifecycle.ts`, `apps/web/src/store/effects/ports.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/effects/constants.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.lifecycle.test.tsx`, `work/T-0915-store-core-t8-lifecycle.md`.

T-0914 changes mobile files and may add small cases to core `ctx.ts` and `ports.ts`. Keep your edits there additive.

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
Run the `realStore*.test.tsx` files, `reload.test.tsx` and `effects/runtime.test.ts` 3 times.

### Acceptance
- The Checks pass, 3 runs.
- The tests-first commit comes before the move.
- No existing test is edited.
- The Report gives the lines per side, R9 and R10, and how mobile keeps its sign-out reset.
- Live check for Julio on web: AI drafts streaming, a network drop and its reconnect, a tab hidden and then shown, and sign-out.

---

## Report (written by the worker when done)

**Commits, in order**
1. `2c2cf013`: tests first. New `apps/web/src/store/realStore.lifecycle.test.tsx` (3 tests), run on the old code: 2 guard tests passed, the new `start()` expectation failed (`getMe` called twice).
2. The move: core `polling.ts` + `lifecycle.ts` with tests, web on them, no existing test edited.

**Core (`packages/client-core/src/store/`)**
- New `polling.ts`: the chat-list and pins polls, the AI draft stream and its timers, `markTurnFinished`, `clearFinishedTurns`, `clearDraftTimeout`, `DRAFT_END_FALLBACK_MS`, `DRAFT_IDLE_MS`, `TOPIC_REFRESH_INTERVAL_MS`, `PINS_REFRESH_INTERVAL_MS`. The polls read the app through `ports.visibility` and `fx.refreshChats` / `fx.refreshActiveChatPins`.
- New `lifecycle.ts`: `readLastRead`, `startStore`, `retryBoot`, `stopStore`, `reset`, `reconnect`, `boot`, `connectXmpp`, `scheduleConnectRetry`, `subscribeToCore`, `CONNECT_RETRY_DELAYS_MS`. The XMPP attempt Scope stays (`Scope.fork(session.scope)` + finalizer). All API calls go through `fromPromise` (R=never), so the core never needs the app's `Ports` service.
- `ports.ts`: gained `api` (`CoreApi`), `rows` (`ChatRows`), `createXmpp`, `visibility`, `drafts`, `notifications` and `flags`; `testCorePorts` fills inert defaults.
- `ctx.ts`: new `StoreAppHooks` (extends `CoreHooks`) and `BootInput`, plus `CoreMe`/`CoreContact`/`CoreXmppToken`/`ChatRows`/`Visibility`/`DraftHubEvent`/`Notifications`/`StoreFlags` in `ports.ts`. `CoreHooks` and `CoreCtx` are unchanged, so `test-ctx.ts` and mobile compile without edits.
- Tests: `polling.test.ts` (7) and `lifecycle.test.ts` (6). One `index.ts` line each in the T8 section.

**Web**
- `effects/polling.ts`: now a 13-line binding (re-exports the core functions). `effects/lifecycle.ts`: bindings for `startStore`/`retryBoot`/`stopStore`, plus the adapter code that stays web-only: `signOutStore` (unchanged behaviour, now calls `reset(ctx)`), the cached paint + `pagehide` (`prepareStart`), the boot state write (`applyBoot`), `applyStop`, and the small bridges that fork the web refreshes. It drops 355 → 155 lines.
- `effects/ports.ts`: builds `visibility` (window focus + `document.visibilityState`), `rows` (web `summariesFor`), `drafts`/`notifications`/`flags`.
- `effects/ctx.ts`: `StoreCtx` now has `fx: StoreAppHooks`, `started` and `boot`.
- `realStore.ts`: the `fx` bag carries the new hooks (badge now delegates to `ports.notifications`); `start`/`stop` still call the web bindings.

**Lines per side**
- Core source: new `polling.ts` 205, `lifecycle.ts` 379; `ctx.ts` +49/−2, `ports.ts` +118/−5, `index.ts` +2. Core tests: `polling.test.ts` 176, `lifecycle.test.ts` 187 (13 tests).
- Web source: `lifecycle.ts` +82/−282, `polling.ts` +13/−199, `ports.ts` +46, `realStore.ts` +34/−5, `constants.ts` +12/−20, `ctx.ts` +13/−1. Web tests: `realStore.lifecycle.test.tsx` +115 (3 tests).

**Behaviour on web: R9 only.** R10 is the core contract and does not change web.
- **R9:** `start()` is idempotent. Core `startStore` returns at once when `ctx.started`; before, a second `start()` without `stop()` began another session and booted again (two cores, double subscriptions). This is the new failing-then-passing expectation.
- **R10:** `stop()` closes the lifetime and clears the ephemeral session state (drafts, finished turns, `fx.applyStop`) but **keeps the message ledger**; `reset()` clears the ledger and the per-session maps. Web already behaved this way: `stop()` kept messages and `signOutStore` reset them, so its visible behaviour is unchanged (it now calls `reset(ctx)` for the ledger).

**How mobile keeps its sign-out reset (T-0901):** T-0901 made mobile `stop()` reset all user state because mobile's store lives across sign-ins. The core keeps the same guarantee as two explicit steps: `stopStore(ctx)` (close the lifetime, drop session state) and `reset(ctx)` (clear the ledger and last-read). Mobile's sign-out calls `stop()` then `reset()`, so on a device the same fields are cleared as after T-0901; a normal resume (which does not call `stop()`) still keeps state. The flag `flags.reconnectOnResume` gates the core `reconnect()` that awaits the in-flight boot, ready for T9.

**Deviations from the spec (with reasons)**
- `ports.ts` gained `api`, `rows` and `createXmpp` beside the four the spec names: the boot and connect moved into the core, so it needs the API, the `/api/chats` row mapping and the XMPP factory (plan section 4's `CoreApi`/`ChatRows`/`createXmpp`).
- `notifications` is built on web, but the live badge path still goes through `fx`/`effects/badge.ts` (T6 put it there because it needs the store) so an un-editable `incoming.ts` keeps working; `realStore`'s `fx.syncBadge`/`dismissChatNotifications` now delegate to the port.
- The app-specific boot side effects stay per-app through the new `StoreAppHooks` on `ctx.fx`: `prepareStart`, `setChatsLoad`, `applyBoot`, `rememberGroupIds`, `scheduleChatsRefresh`, `refreshChats`, `refreshActiveChatPins`, `joinGroups`, `saveChatList`, `refreshDefaultBackground`, `setMediaTrustedHosts`, `setStatus`, `applyStop`. `signOutStore` stays in `effects/lifecycle.ts` as the spec says.
- `reconnect()` (resume) lands in the core behind `flags.reconnectOnResume`, but web leaves the flag off and does not call it; T9 wires mobile.

**Checks (real results)**
- `pnpm gate` (repo root): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/client-core`, `PASS tests @zilar/web`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store`: 20 files, 239 passed.
- `realStore*` + `reload.test.tsx` + `effects/runtime.test.ts`, 3 runs: 10 files, 201 passed each run.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot`: 12 files, 130 passed (117 before + 13 new).
- `@zilar/client-core`, `@zilar/web` and `@zilar/mobile` typechecks: clean.

**Live check for Julio (web):** AI drafts streaming; a network drop and its reconnect (the delay ladder); hide and show the tab; sign out.

**Round (fix round, 2026-10-10)**
- **Finding 1 (must-fix) — fixed** (`d8aaec87`): `signOutStore` in `apps/web/src/store/effects/lifecycle.ts` clears `messageAuthors`, `messageOriginIds` and `messageBaseTexts` again, right after `groupMembers`/`groupInfos`, restoring the old sign-out tail.
- **Finding 2 (should-fix) — fixed** (`9ba1740d`): the sign-out test in `apps/web/src/store/realStore.lifecycle.test.tsx` now also asserts `edits`/`reactions` are empty, and proves the per-message caches are gone with a two-session probe: session A learns the XEP-0308 wire target `origin-a` for `ana-1` (its edit sends a correction), sign-out runs, then a second session on the same store sees `ana-1` without an origin id and an edit sends no correction. With finding 1 reverted the test fails (`sendCorrection` called with `origin-a`); with the fix it passes.
- **Note:** the three maps are not part of web's public `ChatStoreState`, so the test proves they are empty through the ledger behaviour they drive (a surviving origin id still names a wire target) rather than by reading the maps directly.
- **Finding 3 (nit) — not touched:** the eager badge snapshot is in `realStore.ts:207` and `effects/ports.ts:285-287`, lines this round does not change.
- **Checks:** single test `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.lifecycle.test.tsx`: 1 file, 3 passed. `pnpm gate` (repo root): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/client-core`, `PASS tests @zilar/web`; `scope: every changed file is inside the Allowed files`; `GATE PASS`.
- `status` stays `review`.

## Review (written by Claude)

**Lead, 2026-10-10: approved. Clean after 1 automatic round, with 1 nit.**
- **The move:** polling, drafts and the lifecycle are in `packages/client-core/src/store/{polling,lifecycle}.ts`, with 13 core tests. Web `effects/polling.ts` is a 13-line binding, and `effects/lifecycle.ts` keeps only the web adapter (`signOutStore`, the cached paint, `pagehide`). The XMPP attempt Scope and the connect retry ladder stay.
- **Tests first:** `realStore.lifecycle.test.tsx` (connect reject retries, `start()` twice, sign-out), committed before the move.
- **Behaviour:** R9 only on web: `start()` is idempotent, and before, a second `start()` booted twice. R10 is the core contract (`stop()` keeps the ledger, `reset()` clears it). Mobile keeps T-0901's sign-out reset as `stopStore()` then `reset()`. `reconnect()` sits behind `flags.reconnectOnResume`, which T9 wires on mobile.
- **Tests:** no existing test was edited, and the realStore files pass 3 runs.
- **Nit for T9:** `reset()` does not clear `finishedTurns`. That is unreachable today, because every sign-out path calls `stopStore` first.
- **Check:** the combined check passes.
- **Live check for Julio:** on web, AI drafts streaming, a network drop and its reconnect, a hidden tab shown again, and sign-out.
