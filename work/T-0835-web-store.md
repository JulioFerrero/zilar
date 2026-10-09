---
id: T-0835
title: "WS1-WS11: the web chat store on Effect — one Scope for the store lifetime, concerns as Effect modules under store/effects/, XmppCoreEffect, same StoreApi"
status: todo
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

## Review (written by Claude)
