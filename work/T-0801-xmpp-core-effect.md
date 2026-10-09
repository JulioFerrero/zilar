---
id: T-0801
title: "X3-X7: xmpp-core Effect core — events as PubSub/Stream, the remaining async/try sites (restart, credentials, keepalive, afterOnline, send ops, disconnect) as Effects, createXmppCore as an unchanged Promise facade, and a new exported XmppCoreEffect; every existing test unchanged"
status: merged
milestone: M5
branch: task/T-0801-xmpp-core-effect
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-0801 (X3-X7): the xmpp-core Effect core

## Spec (written by Claude, do not edit)

### Why
This is Phase 2 of `docs/audit/effect-100-plan.md` (tasks X3 to X7, plan lines 330-334; design §3.1, lines 178-196), accepted by Julio on 2026-10-09. Julio chose one worker per same-file chain, so the chain is one task. The plan flags it "Julio: messaging and reconnect risk": the lead runs the ejabberd integration tests, and Julio checks messaging live before the next deploy.

### Verified facts (do not re-derive)
- **Done already:**
  - X1: typed errors in `packages/xmpp-core/src/errors.ts` (17 classes, exported from `index.ts:31-50`);
  - X2a: timers as fibers through `schedule()` in `timers.ts`;
  - X2b: requests on `Deferred`;
  - T-0780: request-path tests in `requests.test.ts`.
- **`pnpm effect:map` on main** marks `client.ts` (1,224 lines) `effect` with H1 and W4 left. These are the async and try sites still in `client.ts`:
  - `restartStuckClient` (`async`, line 339; try at 349; `void fresh.start().catch` at 358);
  - the `credentials` provider (line 453, try at 455);
  - `stopAfterFailure` (line 474, try at 486);
  - the keepalive (try at 525, `sendKeepalivePing` at 545, `void current.disconnect().catch` at 575);
  - `afterOnline` and `sendQuietly` (lines 596-610);
  - the reconnect disconnect at 694-695, the ping reply at 822, the reply at 859, `void current.start().catch` at 898;
  - `disconnect` (line 906, try at 919);
  - `leaveRoom` (995), `sendMessage` (1003), `sendReactions` (1026), `sendCorrection` (1036), and the other send operations after line 1036.
- **The public surface:**
  - `index.ts` exports `createXmppCore(options): XmppCore` (lines 56-59), which returns `createCore(options)` (`client.ts:228`);
  - `XmppCore` (`types.ts`) has Promise methods plus `on(event, cb)`, which returns an unsubscribe function.
- **The consumers** are web `apps/web/src/store/realStore.ts`, mobile `apps/mobile/src/store/real-store.ts` and server `apps/server/src/agents/gateway.ts` and `agents/gateway/sessions.ts`. They move later, so `XmppCore` and `createXmppCore` stay exactly as they are.
- **The tests**, which must pass unchanged: `core.test.ts`, `connection-resilience.test.ts`, `events.test.ts`, `presence.test.ts`, `stream-management.test.ts`, `mam.test.ts`, `requests.test.ts`, `timers.test.ts`, `errors.test.ts` and `stanza.test.ts`. The `integration-*.test.ts` files need ejabberd and are gated by `ZILAR_XMPP_INTEGRATION=1`; the lead runs them, not you.

### What to build (in this order, one commit per step, running the xmpp-core suite after each)
1. **X3, events.** One `PubSub` per event kind of `EventPayload` (`types.ts`), with a `Stream` accessor per kind. `on(event, cb)` stays as a thin wrapper that forks a consumer fiber and returns a function that interrupts it. Delivery order and the synchronous-ness that tests rely on must stay the same.
   - If a test proves that `on` callbacks must run synchronously inside the stanza handler, keep the listener sets for `on` and publish to the `PubSub` as well. Say which you did in the Report.
2. **X5, the remaining sites.** The send operations and the other sites listed above become `Effect.fnUntraced` functions. The Promise methods of `XmppCore` call `Effect.runPromise(…)` on them. `sendQuietly` becomes an Effect that logs or ignores exactly as today. Each `void x.catch(...)` becomes `Effect.runFork` with the same handling.
3. **X6, the facade.** `createCore` builds the Effect core and returns the `XmppCore` object as a facade over it. No other module changes its imports.
4. **X7, the Effect API.** Export from `index.ts` a `XmppCoreEffect` type: the Effect-returning methods plus a `Stream` per event, and `createXmppCoreEffect(options)`, or a `Context.Service` with a `layer(options)` (pick one and say why). Old exports stay.

**Keep identical:** every error class and message, the reconnect and backoff behaviour, the keepalive and watchdog timing, the stale-client guards (unless a step makes one provably unnecessary, which you explain), stream management, and the order of stanzas sent after online.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, `docs/audit/effect-100-plan.md` §3.1 (lines 178-196), `packages/xmpp-core/src/client.ts`, `types.ts`, `errors.ts`, `timers.ts`, `index.ts`, `core.test.ts`, `connection-resilience.test.ts`, `events.test.ts`.

### Allowed files
`packages/xmpp-core/src/client.ts`, `packages/xmpp-core/src/index.ts`, `packages/xmpp-core/src/types.ts`, `packages/xmpp-core/src/events.ts`, `packages/xmpp-core/src/core-effect.ts`, `packages/xmpp-core/src/core-effect.test.ts`, `work/T-0801-xmpp-core-effect.md`.

### Checks (wave mode: your package only, see `docs/EFFECT_BRIEF.md`)
```bash
pnpm --filter @zilar/xmpp-core exec vitest run --reporter=dot
pnpm --filter @zilar/xmpp-core typecheck
```
Run the suite 3 times at the end. Add tests for the new `XmppCoreEffect` API in `core-effect.test.ts` (an event `Stream` receives a message, an Effect send fails with the typed error when offline).

### Acceptance
- **The files:** `client.ts` has no `async`, `await`, `try` or `.catch(` of its own; it and any new files are `effect` in `pnpm effect:map`.
- **The surface:** `XmppCore` and `createXmppCore` are unchanged, and `XmppCoreEffect` is exported.
- **The tests:** every existing test passes unchanged, 3 of 3 runs, and the new tests pass.
- **Scope:** only Allowed files change.

---

## Report (written by the worker when done)

**Commits:** X3 `8fccf7ab`, X5 `66e61bb3`, X6 `f5d08ca4`, X7 `69a327ad`; the Report commit follows.

**effect:map kinds** (`pnpm effect:map`, wave mode):
- `client.ts` `effect` (now only the Promise facade; no signals left);
- `core-effect.ts` `effect`, signal H1 (Tier B): the facade-facing `Effect.runPromise` in the `credentials` provider, which the library requires to return a Promise;
- `events.ts` `effect`;
- `index.ts` and `types.ts` `plain` (no async work).
- `client.ts`, `core-effect.ts` and `events.ts` contain no `async`, `await`, `try` or `.catch(` (grep).

**Tests:** xmpp-core before 237 passed / 4 skipped (241); after 245 passed / 4 skipped (249), the 8 new ones in `core-effect.test.ts`. 3 of 3 runs identical. Existing tests unchanged. `pnpm --filter @zilar/xmpp-core typecheck` (both tsconfigs) passes; `oxlint packages/xmpp-core/src` prints nothing. Integration tests not run (lead's job). I did not run `pnpm gate`.

**What I did about `on()` synchronicity:** I tried the spec's first choice (`on` forks a consumer fiber on the PubSub). All 237 existing tests passed with it, so no test proves synchronicity. I still kept the synchronous listener sets for `on` and publish to the PubSub as well (`events.ts`). Reasons: (1) a fiber delivers a scheduler tick later than today; (2) a callback that throws would kill the consumer fiber and silence every later event, where today the throw reaches the stanza handler; (3) the web/mobile stores and the gateway are the messaging path and the plan flags it risky. `emit` calls the listeners first, then `PubSub.publishUnsafe`, so the order of delivery is unchanged. A new test checks `on` is synchronous.

**Structure:** `git mv client.ts core-effect.ts` (history kept). `core-effect.ts` has `createCoreEffect(options, deps): CoreEffect` (the whole closure, now with Effect sites) plus the `ClientOptions`/`ClientFactory`/`CoreDependencies` types. `client.ts` keeps `createCore(options, deps): XmppCore` as a thin facade (`Effect.runPromise` per method, `Effect.runFork` for `sendTyping`/`markDisplayed`) and re-exports those types, so no test or other module changed its imports.

**XmppCoreEffect API shape** (`types.ts`, exported with `SendError`, `EventName`, `EventPayload`, `EventStreams` from `index.ts`):
- sync reads: `status()`, `me()`, `occupants(roomJid)`;
- Effects: `connect(): Effect<void, Error>`, `disconnect(): Effect<void>`, `joinRoom: Effect<void, XmppCoreError>`, `leaveRoom: Effect<void>`, `sendMessage`/`sendCorrection: Effect<{id}, SendError>`, `sendReactions`/`sendRetraction: Effect<void, SendError>`, `loadHistory: Effect<HistoryPage, XmppCoreError>`, `requestUploadSlot: Effect<UploadSlot, XmppCoreError>`, `setPushEnabled: Effect<void, XmppCoreError>`, `sendTyping`/`markDisplayed: Effect<void>` (fire and forget, no-op offline);
- `events`: one `Stream` per event kind (`status`, `message`, `typing`, `displayed`, `occupants`, `presence`, `invited`, `roster`, `error`, `replaced`);
- `SendError = NotOnline | Error`.
- Factory: `createXmppCoreEffect(options)`, a plain factory, not a `Context.Service` + layer: the core is per-login state built from the options (`getToken`, domain) and no consumer provides it through a Layer yet; a Service can wrap it when the apps move. The internal `CoreEffect` also carries the callback `on`, used only by the facade.

**Behaviour differences:**
- A library rejection of `send` that is not an `Error` (never the case for xmpp.js) now reaches the caller as `new Error(String(x))`; an `Error` passes through as the same object. Same text in `error` events.
- `start()`, `stop()`, `disconnect()` and `send()` of the library client are called through `Effect.tryPromise`, so a synchronous throw from them (real xmpp.js never throws synchronously) is now handled like a rejection: in the `void x.catch` sites (`sendTyping`, `markDisplayed`, ping/roster replies, `connect()`'s start) it no longer propagates to the caller; it is reported/ignored like a rejection.
- Continuations after a library Promise resolve through the Effect scheduler instead of a bare `await` microtask, so they may run a tick later (no test is sensitive to it).
- `connect()` now awaits a `Deferred` instead of a hand-made Promise; concurrent callers share the outcome as before.
- Stale-client guards (`current !== xmpp`) kept as they were: the client is not yet a Scope (not asked in this task).
- Otherwise none: error classes and messages, backoff and watchdog schedules, keepalive timing (still `schedule()` from `timers.ts`), stanza order after online, stream management are untouched.

**Unsure:** (1) whether the lead wants the Scope-per-connection redesign (§3.1 Target) as a later task; I kept the stale guards. (2) The `Error` typing of `connect()` is wide because the library's own errors (conflict, SASL, token) pass through as thrown.

## Review (written by Claude)

**2026-10-09, lead (wave 1):** approved. The lead reviewed the Report. The wave 1 combined check (all 12 branches on one tree, by hand) passed the whole-repo typecheck and every package suite: web 1916, server 2279, mobile 2222, xmpp-core 245, runner 63, runner-tunnel 71, devtools 796 after the T-0799 fix, chat-core 174, protocol 174.
- Worker: Sonnet 5.5. X3-X7 in 4 commits. The `on()` listeners stay synchronous and also publish to the PubSub; `XmppCoreEffect` and `createXmppCoreEffect` are exported; 245 tests pass 3 of 3 runs. **The lead ran the ejabberd integration tests: 4 of 4 pass.** Julio checks messaging and reconnect live before the next deploy. Follow-up: the Scope-per-connection redesign (§3.1).
