---
id: T-0835
title: "WS1-WS11: the web chat store on Effect — one Scope for the store lifetime, concerns as Effect modules under store/effects/, XmppCoreEffect, same StoreApi"
status: merged
milestone: M5
branch: task/T-0835-web-store
model: auto
effort: default
depends_on: [T-0801]
estimate: 2 days
---

# T-0835: WS1-WS11: the web chat store on Effect — one Scope for the store lifetime, concerns as Effect modules under store/effects/, XmppCoreEffect, same StoreApi

## Spec (written by Claude, do not edit)

### Why
This is Phase 4 of `docs/audit/effect-100-plan.md`, accepted by Julio on 2026-10-09: rows WS1 to WS11 (lines 397-407), with the design in §3.5 (lines 225-240). Julio chose **one worker per same-file chain**, so the whole chain is one task, done step by step. The plan flags this as the highest-risk piece (connect and reconnect, history, sending), so **Julio checks those flows live before the next deploy**.

### Verified facts (do not re-derive; line ranges are starts only, so re-read each before a step)
- **`apps/web/src/store/realStore.ts`** is one closure, `createRealChatStore`. Cancellation is a manual `generation` counter and teardown is a hand-written `stop()`, with timers scattered through it (plan §3.5). The state container is already one atom (`atomStore.ts`).
- **XmppCoreEffect** is now exported by `@zilar/xmpp-core` (T-0801): `createXmppCoreEffect(options)` gives Effect methods plus one `Stream` per event. The Promise `createXmppCore` stays until X8, so the store may move to the Effect API step by step.
- **The compat `StoreApi`** (`getState`, `setState`, `subscribe`) and every exported type and function stay unchanged, so the store's readers and tests do not move.
- **The tests** are `apps/web/src/store/realStore*.test.tsx`, `reload.test.tsx`, `folders.test.ts` and `search.test.ts` and must pass unchanged. The hazards (plan §3.5) must keep passing: the single-update draft tests, the synchronous read-after-set in `openAtMessage` and `react`, and stable empty selectors. Effect timers do not `unref`, so `stop()` must interrupt every fiber.
- **The `docs/EFFECT_BRIEF.md` building blocks** apply: `Scope`, `Effect.repeat` with `Schedule.spaced` plus `catchDefect`, `timeoutOrElse`, `Deferred`, and fibers instead of timers.

### What to build: the steps, in order, one commit each ("T-0835: <step>"), running the store tests after each
1. **Ports.** The deps object becomes a `Ports` service plus Layers (live and test).
2. **Lifecycle.** `start`, `stop`, boot and reconnect run in one `Scope` opened by `start()` and closed by `stop()`. The `generation` counter, the `unsubscribers` array and the typing-timer record go away; interruption replaces them.
3. **Polling and the draft stream.** `Effect.repeat(Schedule.spaced)` plus `catchDefect`, forked in the store Scope.
4. **History, previews, chat list refresh and `openChat`.**
5. **Send A and send B** (text, attachment, voice, sticker, forward), with `timeoutOrElse` for the send timeouts.
6. **Groups, topics, channels, roles and members.**
7. **Incoming events, edits, reactions, typing (per-chat fibers) and chat prefs.**
8. **Pins and the media panel.**
9. **Sweep.** No `async`, `await`, `try` or timers left in `apps/web/src/store/realStore.ts`. Each concern lives in its own file under `apps/web/src/store/effects/` (lifecycle, polling, history, send, groups, events, pins). **WS11:** move `createChatStore` (the mock store) and its types out of `store.ts` into `apps/web/src/store/mockStore.ts`; that file gets the marker `// effect-plain: in-memory mock store for demos and tests`, and `store.ts` re-exports, so no import changes.

**Keep identical:** every text, the order of side effects, the retry and timeout values, and when the state updates (the tests check it). The pure helpers (the edit, reaction and id-alias bookkeeping, `toUiMessage`, `summaryFor`) stay plain.

**Work method:** after each step, run the store tests 3 times and the package typecheck, then commit. If you run low on budget, stop after a completed step, write in the Report which steps are done, set `status: review`, and commit. The lead resumes you for the rest.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (read it from `/Users/julio/personal-projects/galena/docs/EFFECT_BRIEF.md` if it is not in your worktree), `docs/audit/effect-100-plan.md` §3.5, `apps/web/src/store/realStore.ts`, `apps/web/src/store/atomStore.ts`, `packages/xmpp-core/src/core-effect.ts` and `index.ts`, and the store tests.

### Allowed files
`apps/web/src/store/realStore.ts`, `apps/web/src/store/effects/*.ts` (new files), `apps/web/src/store/effects/*.test.ts` (new tests), `apps/web/src/store/store.ts`, `apps/web/src/store/mockStore.ts`, `work/T-0835-web-store.md`.

### Checks (wave mode: the store tests and the package typecheck only)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web typecheck
```

### Acceptance
- **The files:** after step 9, `apps/web/src/store/realStore.ts` is `plain` or `effect` in `pnpm effect:map`, and every new `effects/*.ts` file is `effect`.
- **The surface:** `StoreApi` and the exports are unchanged.
- **The tests:** every existing store test passes unchanged, 3 of 3 runs, and the typecheck is clean.
- **Scope:** only Allowed files change.

---

## Report (written by the worker when done)

**Steps done: all 9.** One commit per step, plus the sweep commit below (steps 1 to 8 are separate commits, step 9 is the last commit).

| Step | Commit message | Main files |
| --- | --- | --- |
| 1 Ports | `T-0835: Ports` | `effects/ports.ts`, `constants.ts`, `chatRows.ts`, `runtime.ts` |
| 2 Lifecycle | `T-0835: Lifecycle` | `effects/ctx.ts`, `util.ts`, `lifecycle.ts` |
| 3 Polling and the draft stream | `T-0835: Polling and the draft stream` | `effects/polling.ts`, `pins.ts` |
| 4 History, previews, chat list, `openChat` | `T-0835: History, previews, chat list refresh and openChat` | `effects/history.ts` |
| 5 Send A and send B | `T-0835: Send A and send B` | `effects/send.ts`, `sendFailure.ts` |
| 6 Groups, topics, channels, roles, members | `T-0835: Groups, topics, channels, roles, members` | `effects/groups.ts`, `groupMembers.ts` |
| 7 Incoming events, edits, reactions, typing, prefs | `T-0835: Incoming events, edits, reactions, typing, chat prefs` | `effects/incoming.ts`, `messageActions.ts`, `prefs.ts`, `badge.ts` |
| 8 Pins and media panel | `T-0835: Pins and media panel` | `effects/pins.ts` |
| 9 Sweep and WS11 | `T-0835: Sweep and mock store` | `effects/reads.ts`, `mockStore.ts`, `store.ts` |

**effect:map kinds** (`pnpm effect:map`, last run at the sweep):
- `apps/web/src/store/realStore.ts`: `plain` (no `async`, `await`, `try`, `.then`, `.catch` or timers left; the only closure code left is the plain id-alias, edit, reaction, send-status and name bookkeeping, which the spec says stays plain).
- `apps/web/src/store/store.ts`: `plain` (types, folder helpers, re-exports). `apps/web/src/store/mockStore.ts` carries the `// effect-plain:` marker as its first line.
- `effect`: `effects/badge.ts`, `groupMembers.ts`, `groups.ts`, `history.ts`, `incoming.ts`, `lifecycle.ts`, `messageActions.ts`, `pins.ts`, `polling.ts`, `ports.ts`, `prefs.ts`, `reads.ts`, `runtime.ts`, `send.ts`, `util.ts`.
- `plain` (not `effect`): `effects/chatRows.ts`, `constants.ts`, `ctx.ts`, `sendFailure.ts`. These are pure data, types and mapping functions with no effects to run; I did not add an `effect` import only to change the label. This is the one place where the acceptance line "every new `effects/*.ts` is `effect`" is not met literally.

**Tests:** the original 196 store tests pass unchanged. With the new tests there are 17 test files and 222 tests, and the store run was green 3 of 3 times at every step (counts: 196 baseline, 200 after step 1, 205, 208, 211 after step 4, 211 through step 8, 222 after the new `sendFailure`, `chatRows` and `reads` tests). The web typecheck is clean, and `oxlint` on every changed file is clean (0 errors). I ran only the Checks, never the whole suite and never `pnpm gate`.

**Design in one paragraph.** The store has one lazily opened Scope (`start` to `stop`), a session Scope per boot attempt (`start`, `retryChats`) and a per-connection Scope inside it. `FiberSet`/`FiberMap` runners start fibers synchronously, so the synchronous parts of `openAtMessage`, `react` and the draft tests keep their timing. The effect modules take `ctx` (state accessors, ports, lifetime and the plain helpers in `ctx.k`). The core's event listeners stay plain synchronous callbacks, because the tests' fake cores emit synchronously.

**Behaviour differences:**
1. In-flight work now belongs to the store Scope, so `stop()` interrupts it. Before, a Promise that was already running (a text, voice, attachment, sticker or forward send, a reaction/edit/delete send, a group-member load) kept going after `stop()` and could still write state or flip a bubble to `failed`; now it ends at `stop()`. No test depends on the old behaviour. A request that is already on the wire is still sent; only its later effect on the store is dropped.
2. The 60 s send deadline (`SEND_TIMEOUT_MS`, same value, same `timed_out` reason) is now a fiber that waits on a `Deferred` with `timeoutOrElse`, not a `setTimeout`. The run-token rules are the same: a retry replaces the previous deadline, a late result from an older run is ignored, and `stop()` and `deleteFailedMessage` drop the deadline.
3. The badge sync and the notification dismiss run as detached fibers (not tied to `stop()`, like the Promises they replace). Their result and their errors are still ignored.
4. Otherwise none: texts, order of side effects, retry delays, timeouts and the moment of every `set` are the same, and the actions reject with the original error value.

**Unsure / for Julio:** the highest-risk flows (connect and reconnect, history paging, sending text/voice/attachment, and stop/start) are covered by the existing fake-core tests but should be checked live before the next deploy, as the spec says. Difference 1 is the one I would watch: sign out and sign in again, and send during a reconnect.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Sonnet 5.5 (chain). The lead reviewed the Report.
- **Shape:** 9 commits, one per step. `realStore.ts` has no async, try or timers left, and its concerns live in `store/effects/`. `createChatStore` moved to `mockStore.ts` (effect-plain marker, as decision D3 allows), and `store.ts` re-exports it, so no import changed. `StoreApi` is unchanged.
- **Lead check, rebased on main:** oxlint is clean, the web typecheck passes, and the full web suite gives 1943 passed. Four helper files with only data and pure functions are `plain`, which the 100% rule accepts.
- **Behaviour:** `stop()` now also interrupts in-flight sends, reaction, edit and delete sends, and member loads (the same as mobile T-0836). The 60 s send deadline is a fiber with the same value and reasons.
- **Before the next deploy:** Julio checks live sign out and back in, connect and reconnect, history paging, and sending during a reconnect.
