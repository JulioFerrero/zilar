---
id: T-0801
title: "X3-X7: xmpp-core Effect core — events as PubSub/Stream, the remaining async/try sites (restart, credentials, keepalive, afterOnline, send ops, disconnect) as Effects, createXmppCore as an unchanged Promise facade, and a new exported XmppCoreEffect; every existing test unchanged"
status: todo
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

## Review (written by Claude)
