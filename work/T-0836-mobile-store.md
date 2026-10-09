---
id: T-0836
title: "MS1-MS10: the mobile chat store on Effect — one Scope for the store lifetime (incl. AppState resume), concerns as Effect modules under store/effects/, XmppCoreEffect, same StoreApi"
status: merged
milestone: M5
branch: task/T-0836-mobile-store
model: auto
effort: default
depends_on: [T-0801]
estimate: 2 days
---

# T-0836: MS1-MS10: the mobile chat store on Effect — one Scope for the store lifetime (incl. AppState resume), concerns as Effect modules under store/effects/, XmppCoreEffect, same StoreApi

## Spec (written by Claude, do not edit)

### Why
This is Phase 4 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09: rows MS1 to MS10 (lines 438-447), with the design in §3.5 (lines 225-240). Julio chose **one worker per same-file chain**, so the whole chain is one task, done step by step. The plan flags this as the highest-risk piece (connect and reconnect, history, sending), so **Julio checks those flows live before the next deploy**.

### Verified facts (do not re-derive; line ranges are starts only, so re-read each before a step)
- **`apps/mobile/src/store/real-store.ts`** is one closure, `createRealChatStore`. Cancellation is a manual `generation` counter and teardown is a hand-written `stop()`, with timers scattered through it (plan §3.5). The state container is already one atom (`atomStore.ts`).
- **XmppCoreEffect** is now exported by `@zilar/xmpp-core` (T-0801): `createXmppCoreEffect(options)` gives Effect methods plus one `Stream` per event. The Promise `createXmppCore` stays until X8, so the store may move to the Effect API step by step.
- **The compat `StoreApi`** (`getState`, `setState`, `subscribe`) and every exported type and function stay unchanged, so the store's readers and tests do not move.
- **The tests** are `apps/mobile/src/store/real-store*.test.ts`, `chat-store*.test.ts`, `selector-stability.test.ts` and the other `src/store` tests and must pass unchanged. The hazards (plan §3.5) must keep passing: the single-update draft tests, the synchronous read-after-set in `openAtMessage` and `react`, and stable empty selectors. Effect timers do not `unref`, so `stop()` must interrupt every fiber.
- **The `docs/EFFECT_BRIEF.md` building blocks** apply: `Scope`, `Effect.repeat` with `Schedule.spaced` plus `catchDefect`, `timeoutOrElse`, `Deferred`, and fibers instead of timers.

### What to build: the steps, in order, one commit each ("T-0836: <step>"), running the store tests after each
1. **Ports.** The deps object becomes a `Ports` service plus Layers (live and test).
2. **Lifecycle.** `start`, `stop`, boot and reconnect run in one `Scope` opened by `start()` and closed by `stop()`. The `generation` counter, the `unsubscribers` array and the typing-timer record go away; interruption replaces them.
3. **Polling and the draft stream.** `Effect.repeat(Schedule.spaced)` plus `catchDefect`, forked in the store Scope.
4. **History, previews, chat list refresh and `openChat`.**
5. **Send A and send B** (text, attachment, voice, sticker, forward), with `timeoutOrElse` for the send timeouts.
6. **Groups, topics, channels, roles and members.**
7. **Incoming events, edits, reactions, typing (per-chat fibers) and chat prefs.**
8. **Pins and the media panel.**
9. **Sweep.** No `async`, `await`, `try` or timers left in `apps/mobile/src/store/real-store.ts`. Each concern lives in its own file under `apps/mobile/src/store/effects/` (lifecycle, polling, history, send, groups, events, pins). **MS10:** `apps/mobile/src/store/chat-store.ts` (the mock store) gets the marker `// effect-plain: in-memory mock store for demos and tests`. Lifecycle includes the AppState background and resume reconnect.

**Keep identical:** every text, the order of side effects, the retry and timeout values, and when the state updates (the tests check it). The pure helpers (the edit, reaction and id-alias bookkeeping, `toUiMessage`, `summaryFor`) stay plain.

**Work method:** after each step, run the store tests 3 times and the package typecheck, then commit. If you run low on budget, stop after a completed step, write in the Report which steps are done, set `status: review`, and commit. The lead resumes you for the rest.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (read it from `/Users/julio/personal-projects/galena/docs/EFFECT_BRIEF.md` if it is not in your worktree), `docs/audit/effect-100-plan.md` §3.5, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/atomStore.ts`, `packages/xmpp-core/src/core-effect.ts` and `index.ts`, and the store tests.

### Allowed files
`apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/effects/*.ts` (new files), `apps/mobile/src/store/effects/*.test.ts` (new tests), `apps/mobile/src/store/chat-store.ts`, `work/T-0836-mobile-store.md`.

### Checks (wave mode: the store tests and the package typecheck only)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile typecheck
```

### Acceptance
- **The files:** after step 9, `apps/mobile/src/store/real-store.ts` is `plain` or `effect` in `pnpm effect:map`, and every new `effects/*.ts` file is `effect`.
- **The surface:** `StoreApi` and the exports are unchanged.
- **The tests:** every existing store test passes unchanged, 3 of 3 runs, and the typecheck is clean.
- **Scope:** only Allowed files change.

---

## Report (written by the worker when done)

**Steps:** all 9 done, one commit each (1e9af065 ports, 4c6b3db7 lifecycle, c4ee58c0 polling, da4d441a history, c1290fcf send, a5004384 groups, afde98b2 events, 1ba8baa9 pins, plus the step 9 sweep commit).

**Tests:** `src/store` 315 passed, 1 skipped (the skip was there before), 3 of 3 runs. Existing store tests are unchanged; 12 new tests live in `effects/*.test.ts` (ports 4, runtime, history 2, send 3, groups 3, events 4, pins 2). Mobile typecheck clean, `oxlint apps/mobile/src/store` clean, prettier run on every commit.

**effect:map:** `real-store.ts` is `effect` (no signals). `effects/events.ts`, `history.ts`, `pins.ts`, `polling.ts` are `effect` with no signals. `groups.ts` (`Deferred.await`), `lifecycle.ts` (`Fiber.await`), `ports.ts` (`Promise.reject` in the voice fallback) are `effect` with a false H1 signal; `runtime.ts` and `send.ts` are `effect` with W4 on `Effect.catch`. `chat-store.ts` is `exempt` (marker added).

**Layout:** `ports.ts` (Ports service, Live and Test layers), `runtime.ts` (two Scopes: the session closed by `stop()` and the generation restarted by start/stop/reload; `lift`, `recover`, `failAfter`, `orElse`, the shared `StoreCtx`), and the modules `lifecycle`, `polling`, `history`, `send`, `groups`, `events`, `pins`. The generation counter, the unsubscriber lists and the typing/refresh timer records are gone. `real-store.ts` keeps the pure helpers (edits, reactions, message mapping) and the returned `StoreApi` object.

**Behaviour differences:** none intended in values, text, retry/timeout numbers or the order of state updates. Known small ones, all from running as fibers of the session scope:
- Fire-and-forget work that the old code let run after `stop()` is now interrupted by `stop()`: the failure rollback of a reaction/edit/delete send, `ensureGroupDetail`/`ensureGroupMembers` started by typing events, and the debounced chat-list refresh. Nothing visible while the store runs.
- A `sendReactions`/`sendCorrection`/`sendRetraction` that throws synchronously (instead of rejecting) now takes the rollback path instead of throwing out of the action.

**Kept on purpose:** the Promise `XmppCore` stays (wrapped with `lift`); `XmppCoreEffect` streams would deliver one tick late and the tests inject Promise fakes. The closure variables the pure helpers still read (`core`, `chatPrefRows`, the maps) are bridged to the shared state `s` with getters and setters.

**Unsure:** nothing blocking. The lead may want a look at the phone smoke test, since the typing line, draft timers and the 500 ms refresh debounce now run on fibers (all covered by tests with fake timers).

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5 (chain). The lead reviewed the Report.
- **Shape:** 9 commits, one per step. `real-store.ts` went from about 4350 to 1929 lines, and its concerns moved to `store/effects/`. The store API is unchanged and the Promise `XmppCore` stays behind `lift`.
- **Lead check, rebased on main:** oxlint is clean, the mobile typecheck passes, and the full mobile suite gives 2254 passed and 2 skipped. No files overlap the wave 2 branches.
- **Behaviour:** `stop()` now also interrupts reaction, edit and delete rollbacks, typing-triggered group loads and the chat-list refresh debounce. These are background jobs that should not outlive the session, so this is accepted.
- **Before the next mobile release:** Julio checks connect, resume after background, and sending on the phone. A phone smoke of main also runs after the wave merges.
