---
id: T-1360
title: "Push component: @xmpp/component's built-in IQ callee answers every publish IQ with service-unavailable before our handler's result, so ejabberd disables push after the first notification — route publish (and disco) through xmpp.iqCallee so exactly one reply (result) is sent"
status: merged
milestone: M5
branch: task/T-1360-component-iq-callee
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1360: Component IQ callee

## Spec (written by Claude, do not edit)

### Why
**Live evidence (lead, 2026-10-14, VPS logs):** after T-1357 made ejabberd publish, every push is followed at once by
```
[warning] push.chat.zilar.app rejected notification for pzooiu…@chat.zilar.app (pSdaemA6…), disabling push: service-unavailable
```
That happened at 11:49:21, 11:52:59 and 12:02:00, all 3 pushes since the deploy. Each time the server also logged `push sent`, and the phone got the FCM push. But ejabberd then **disables push for that session**, so the next message to the closed app pushes nothing (test 9 at 12:03).

**Cause:**
- `@xmpp/component` 0.14.0 installs the `iqCallee` middleware: `node_modules/.pnpm/@xmpp+component@0.14.0/node_modules/@xmpp/component/index.js:5,15,33`.
- Its handler (`@xmpp/iq/callee.js`, around `:57-90`) answers any IQ `get`/`set` with no registered route with `buildError("cancel", "service-unavailable")` (`:79-81`).
- `apps/server/src/push/component.ts` registers no route. It handles everything from `xmpp.on('stanza', …)` (`:75-78`) and later sends its own `result` (`answerIq`, `handleNotification` `:166-210`; `handleNonPushStanza` `:134-153`). So ejabberd gets the library's error first, and the comment at `:32-35` ("ejabberd disables a push pair after an error IQ") describes exactly what now happens.

### What to do
1. **Register the publish handler with the callee:** `xmpp.iqCallee.set(PUBSUB_NAMESPACE, 'pubsub', handler)` (check the API in `@xmpp/iq/callee.js`; cite it).
   - **The handler returns truthy at once,** so the callee sends a single `result`; this keeps the "always answer result" rule.
   - **Delivery is forked** onto the existing per-node chain, so ordering per node is unchanged.
   - **Remove our manual `answerIq` for publishes,** so ejabberd never gets two replies.
   - **A malformed publish** keeps today's behaviour: check what the current code does and keep it, but it must never send an error IQ.
2. **Disco `get`:** register `xmpp.iqCallee.get('http://jabber.org/protocol/disco#info', 'query', …)` returning the existing `discoInfoHandler` content. Other IQ `set`s keep getting a bare `result` (a catch-all `set` handler if the callee API allows it; otherwise explain).
3. **Update `apps/server/src/push/xmpp-component.d.ts`** with the `iqCallee` types used.
4. **Test** (message pipeline, allowed), in a new `apps/server/src/push/component.test.ts`. Use a fake component that runs the same callee middleware, or the real `@xmpp/iq/callee` with a fake entity. **Prove** a publish IQ gets exactly one reply, of type `result`, and that delivery ran. Keep it small. Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/server/src/push/component.ts`, `apps/server/src/push/xmpp-component.d.ts`, `apps/server/src/push/protocol.ts`, `node_modules/.pnpm/@xmpp+component@0.14.0/node_modules/@xmpp/component/index.js`, `node_modules/.pnpm/@xmpp+iq@*/node_modules/@xmpp/iq/callee.js`.

### Allowed files
`apps/server/src/push/component.ts`, `apps/server/src/push/component.test.ts`, `apps/server/src/push/xmpp-component.d.ts`, `apps/server/src/push/protocol.ts`, `work/T-1360-component-iq-callee.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/push/component.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the new test passes.
- **Live after the deploy:** the ejabberd log shows no new "rejected notification … service-unavailable", and two DMs in a row to the closed app both log `push sent`.

---

## Report (written by the worker when done)

### What I did

Root cause confirmed in `@xmpp/component` 0.14.0: `component()` installs `@xmpp/iq/callee.js`
(`index.js:15,33`), whose `iqHandler` answers **every** `get`/`set` IQ that matches no registered
route with `buildError('cancel', 'service-unavailable')` (`callee.js:79-81`). `component.ts`
registered no route, handled publishes from `xmpp.on('stanza', …)` and then sent its own `result`,
so ejabberd got the callee's error IQ first and disabled the push pair.

Changes (all inside the Allowed files):

1. `apps/server/src/push/component.ts`
   - Replaced the `xmpp.on('stanza', …)` listener with a callee route:
     `xmpp.iqCallee.set(PUBSUB_NAMESPACE, 'pubsub', handler)`. The handler parses the publish,
     forks delivery onto the existing per-node `chains`/`afterPrevious` fiber chain, and returns
     `true`. A truthy return makes `@xmpp/component` build **exactly one** `result` reply
     (`callee.js:72-90`: `if (!reply) reply = buildError(...)` then `buildReplyResult`); it is sent
     as soon as the handler returns, before delivery finishes.
   - Removed our manual answers: the `answerIq` call at the end of `handleNotification`, and the
     `handleNonPushStanza` / `sendQuietly` / `withEnvelope` / `answerIq` helpers.
   - Malformed publish keeps today's behaviour: the route still matches any `set` IQ with a
     `<pubsub>` child, `parsePushIq` returns `undefined`, the handler returns `true` → one bare
     `result`, and nothing is delivered. Never an error IQ.
   - Disco `get`: `xmpp.iqCallee.get(DISCO_INFO_NAMESPACE, 'query', () => discoInfoQuery())`. The
     old exported `discoInfoHandler` was replaced by a private `discoInfoQuery()` that returns the
     `<query>` **content** (identity + `urn:xmpp:push:0` + pubsub features), because the callee
     appends the returned element to the `result` envelope it builds; returning the old full `iq`
     element would have nested an IQ inside an IQ. `discoInfoHandler` had no callers outside this
     module (checked repo-wide), so removing it is safe.
2. `apps/server/src/push/xmpp-component.d.ts` — added `PushIqContext`, `PushIqRouteHandler`,
   `PushIqCallee`, and `iqCallee: PushIqCallee` on `PushComponent`, matching `callee.js`.
3. `apps/server/src/push/component.test.ts` (new) — uses the **real** `@xmpp/component` (hence the
   real callee middleware) as a never-connected fake: `start`/`stop` resolve and `send` records
   replies. `handleIncomingPush` is stubbed with `vi.mock('./service', …)` so the test is a pure
   unit test of the routing. Three cases: a valid publish → exactly one reply, `type=result`, id/to
   correct, no `<error>` child, and `handleIncomingPush` called once with the parsed notification;
   a malformed publish → one `result`, delivery not called; a disco `get` → one `result` carrying
   our identity and features.

### Deviation from the spec (disco / other IQ sets)

Point 2 says "Other IQ `set`s keep getting a bare `result` (a catch-all `set` handler if the callee
API allows it; otherwise explain)". The callee API does **not** allow it: `@xmpp/iq/callee.js`
exposes only `get(ns, name, handler)` / `set(ns, name, handler)`, each registered through
`route(type, ns, name, handler)`, which matches on `ctx.element.is(name, ns)` (exact element name +
namespace, `callee.js:47-52`); there is no wildcard or catch-all. So an unmatched `set` now gets the
callee's own reply (`service-unavailable` error) instead of a bare `result`. Note this is not a new
sender-visible error: before this change those IQs already received the callee's error and our
`result`; the change only removes the second, spurious reply. In practice ejabberd's `mod_push`
only ever sends the pubsub publish `set`, which is routed. If the lead wants the old bare `result`
for every other set, it can be added as one extra function on the underlying middleware
(`xmpp.middleware.use`), which is what the callee itself uses; I did not add it because the spec
scoped the fix to the callee API.

### Commands run (real results)

- `pnpm install` — installed, no `pnpm-lock.yaml` change.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/component.test.ts`
  → `Test Files 1 passed (1)`, `Tests 3 passed (3)`.
- `pnpm gate` — first run: `FAIL format` on `component.ts` / `component.test.ts` (Prettier); I ran
  `pnpm exec prettier --write` on those two files and re-ran. Second run:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (0.8s)
PASS  format  (1.0s)
PASS  lint  (1.2s)
PASS  typecheck  (3.2s)
PASS  effect  (0.7s)
PASS  tests @zilar/server  (12.9s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

### Files changed

- `apps/server/src/push/component.ts` (modified)
- `apps/server/src/push/component.test.ts` (new)
- `apps/server/src/push/xmpp-component.d.ts` (modified)
- `work/T-1360-component-iq-callee.md` (this Report)

`apps/server/src/push/protocol.ts` was listed as Allowed but needed no change.

### Not done / not verifiable here

- The live acceptance (ejabberd log shows no new "rejected notification … service-unavailable",
  and two DMs in a row to the closed app both log `push sent`) can only be checked after a deploy
  to the VPS; I did not run it.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean (1 nit); the packet is current for `8d95b48f`.**
- **Publish** goes through `iqCallee.set(pubsub)` returning `true`: one `result`, and delivery is forked onto the per-node chain.
- **Disco** goes through `iqCallee.get`.
- **Lead ran** `component.test.ts`: 3 passed.
- **Live check after the deploy:** no new "rejected notification", and two DMs in a row to the closed app both push.
