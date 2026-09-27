---
id: T-0021
title: Fix random disconnects — XEP-0198 stream-management ack miscount (xmpp.js over WebSocket)
status: review
milestone: M1
branch: task/T-0021-sm-ack-bug
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0016]
estimate: 1 day
---

# T-0021: Stream-management ack bug

## Spec (written by Claude, do not edit)

### Goal
During the T-0016 review, ejabberd sometimes closed a client session right after login with:

```
Closing c2s session for <jid>: Stream closed by local host: Client acknowledged more stanzas than sent by server (undefined-condition)
```

That means our client (`@xmpp/client`, used inside `@galena/xmpp-core` over **WebSocket**) sent a stream-management (XEP-0198) `<a h='N'/>` with an `h` **larger** than the number of stanzas ejabberd actually sent. In the apps this would look like **random disconnects**. There's a known discussion upstream: xmpp.js discussion #1009, "Stream-management ack for websocket connection in react native".

**Find the root cause and fix it** so sessions stay up, **without** losing what stream management gives us (or, if disabling SM is the only safe choice, prove it and explain the trade-off; see Decisions).

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0016-xmpp-core.md`: the whole file, especially the round 2 Review
- `packages/xmpp-core/src/client.ts` and the ambient types in `src/types/xmpp.d.ts`
- The installed `@xmpp/client` and `@xmpp/stream-management` source under `node_modules` (read it: how the inbound counter is incremented, what counts as a stanza, and how `<open/>`, `<close/>`, stream features, `<enabled/>`, `<r/>` and `<a/>` are handled over the WebSocket framing)
- XEP-0198 §4: only `message`, `presence` and `iq` stanzas count. Nonzas (`<enabled/>`, `<r/>`, `<a/>`, stream features, SASL elements) must not be counted.
- xmpp.js discussion #1009 and any related upstream issues or PRs (use web fetch)

### Allowed files
- `packages/xmpp-core/**`
- `pnpm-lock.yaml`, only if you pin or patch a dependency version
- If a dependency patch is truly needed: `patches/**` and the `pnpm.patchedDependencies` entry. **Ask first** in the Report (`status: blocked`) before touching root files.

**Docker:** you may use the dev stack (`pnpm infra:up` / `infra:down`, no reset). You're the only worker using it now.

### Decisions
- **Preferred fix (in `@galena/xmpp-core`):**
  - Work around the miscount without patching `node_modules`, for example by correcting the counter, by wrapping or overriding the SM ack handler through the public `streamManagement` object, or by configuring it.
  - Keep stream management **enabled** if that can be done correctly.
- **If** the only reliable fix is disabling stream management:
  - That's acceptable, because we recover with reconnect plus MAM history.
  - Document exactly why, and make sure a reconnect still refetches missed messages (MAM `after` the last seen id, or the latest page).
  - Report this clearly as a decision for Claude to review.
- **Never** silence the error by catching and ignoring the disconnect.

### What to build
1. **A reproduction first.** An integration test (gated by `GALENA_XMPP_INTEGRATION=1`, like T-0016's) that keeps two clients connected for **at least 60 s** while exchanging **≥ 200 stanzas**: messages, presence, iq pings, and forcing `<r/>` requests if possible. It asserts:
   - no unexpected `disconnect` / `offline`
   - the status stays `online`
   - after the run, ejabberd's log for that window has **no** "Client acknowledged more stanzas" line (read it with `docker compose … logs --since`)

   Run it **before** your fix and confirm it fails or reproduces. Paste the evidence.
2. **The root cause:** explain in the Report exactly which inbound elements are counted wrongly, with a code reference into the installed xmpp.js version.
3. **The fix,** plus unit tests: a fake inbound sequence of stanzas and nonzas gives the right `h`.
4. Rerun the reproduction **3 times** after the fix. All pass. Paste the output.

### Acceptance criteria
- [ ] Before and after evidence in the Report: the failing reproduction, then 3 passing runs.
- [ ] The root cause is explained with code references.
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass (integration skipped by default).
- [ ] Only allowed files touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm infra:up && GALENA_XMPP_INTEGRATION=1 pnpm --filter @galena/xmpp-core test; pnpm infra:down
```

### Out of scope
- Any other xmpp-core feature. The server. The apps.

---

## Report (written by the worker when done)

### What I did

- **Root cause reproduced and fixed in `@galena/xmpp-core`, with stream management kept enabled.**
- Added `packages/xmpp-core/src/stream-management.ts`: a small XEP-0198 §4 counter that is the source of truth for the client's inbound `h`. It starts at zero on `<enabled/>`, continues on `<resumed/>`, counts only `message`/`presence`/`iq`, and rewrites the `h` of every outgoing `<a/>` and `<resume/>` before it is written (`installStreamManagementAck` patched `client.send`). It also stops counting on `disconnect`/`offline` without losing the count, so a later `<resume/>` still carries the true value. It is a no-op for clients without a `streamManagement` object (unit-test fakes).
- Wired it in `packages/xmpp-core/src/client.ts` (`installStreamManagementAck(created)` right after `attachHandlers`).
- Extended the ambient `@xmpp/client` types with `on('element')`, `on('send')` and `on('disconnect')`.
- Added `packages/xmpp-core/src/stream-management.test.ts` (9 unit tests): pre-enable stanzas are not counted; `<enabled/>` resets and starts; nonzas (`<features>`, `<enable/>`, `<r/>`, `<a/>`, `<failed/>`) do not count; `<resumed/>` continues; `stop()` keeps the value; outgoing `<a/>`/`<resume/>` get the right `h` (and other elements do not); plus a regression test for the exact T-0021 sequence (pre-enable presence echo + `<enabled/>` + IQ result + `<r/>` → `<a h="1"/>`, not `2`); plus two tests for `installStreamManagementAck` (with and without a `streamManagement` object).
- Added `packages/xmpp-core/src/integration-sm.test.ts`, the required reproduction: two clients, 60 s, 200+ stanzas (room/DM messages, typing, presence), asserting no unexpected status change, both stay `online`, and `docker compose … logs --since` has **no** "Client acknowledged more stanzas" line. Gated by `GALENA_XMPP_INTEGRATION=1` like T-0016's. `GALENA_XMPP_SM_DURATION_MS` / `GALENA_XMPP_SM_STANZAS` make it tunable (defaults 60000 / 220).
- Excluded the new integration file from the library tsconfig (it imports Node/server code); it is typechecked by `tsconfig.integration.json`, so the "no Node types" guarantee stays honest.

### Root cause

xmpp.js 0.14 keeps a single inbound counter `streamManagement.inbound` and writes it into every acknowledgement it sends. The counter is wrong around the `<enable/>`/`<enabled/>` handshake **over WebSocket**:

- In `node_modules/.pnpm/@xmpp+stream-management@0.14.0/node_modules/@xmpp/stream-management/index.js`, the incoming middleware (lines 125-142) increments `sm.inbound` for **every** `message`/`presence`/`iq` from the very first element, regardless of whether stream management is enabled:
  ```js
  if (["presence", "message", "iq"].includes(stanza.name)) {
    sm.inbound += 1;
  }
  ```
- The correction only happens in `enabled()` (lines 107-115), i.e. **after** `<enabled/>` has been parsed and its promise resolved: `sm.inbound = 0;`. That reset is asynchronous (a microtask after `await promiseEnable` in `stream-features.js`), while stanzas already parsed in the same batch keep incrementing the stale value.
- `sendAck()` (lines 51-55) and `makeResumeElement()` (lines 21-23) then put that stale value into `<a h="…"/>` / `<resume h="…"/>`.

Our client makes the window fire deterministically: `online` fires when resource binding completes, so `afterOnline` (`client.ts`) sends the initial `<presence/>` **before** xmpp.js sends `<enable/>`. The server echoes that presence **while stream management is still inactive**, so ejabberd does *not* count it (`mgmt_stanzas_out` stays 0). The client, however, counts it (`sm.inbound` = 1), and `<enabled/>` + the carbons `<iq type="result"/>` + the server's first `<r/>` arrive in the same parser batch, so the reset has not run when `<r/>` triggers `sendAck()`. Result:

```
OUT <iq type="set">                                  (bind)
IN  <iq type="result">          inbound=0 enabled=false
OUT <presence>                                       (initial presence, before <enable/>)
OUT <enable>
OUT <iq type="set">                                  (carbons enable)
IN  <presence from=me@…>        inbound=1 enabled=false   <- server sent it while inactive
IN  <enabled>                   inbound=1 enabled=false
IN  <iq … type="result">        inbound=2 enabled=false   <- carbons result
IN  <r>                         inbound=2 enabled=false
OUT <a h=2>                                          <- server had sent only 1
```

ejabberd then closes the session: `… acknowledged 2 stanzas, but only 1 were sent` → `Client acknowledged more stanzas than sent by server (undefined-condition)`.

There is a second inaccuracy in the same file: `@xmpp/iq/caller.js` `_route` handles IQ replies and does **not** call `next()` (node_modules/.pnpm/@xmpp+iq@0.14.0/.../caller.js lines 24-41), and the stream-management counter is registered *after* the IQ caller, so xmpp.js never counts incoming `<iq type="result|error"/>`. The server does count them, so xmpp.js undercounts there. The new counter observes the raw `element` event and counts them correctly.

### Files changed

- New `packages/xmpp-core/src/stream-management.ts` — the corrected XEP-0198 inbound counter and the `installStreamManagementAck` wiring.
- New `packages/xmpp-core/src/stream-management.test.ts` — 9 unit tests.
- New `packages/xmpp-core/src/integration-sm.test.ts` — the 60 s / 200+ stanza reproduction.
- Modified `packages/xmpp-core/src/client.ts` — install the corrected counter.
- Modified `packages/xmpp-core/src/types/xmpp.d.ts` — `element`, `send`, `disconnect` overloads.
- Modified `packages/xmpp-core/tsconfig.json` — exclude `integration-sm.test.ts` from the library build.
- Modified `work/T-0021-sm-ack-bug.md` — status + this Report.

No `pnpm-lock.yaml` change, no dependency change, no `patches/`, no root-file change.

### Commands run and real results (before / after)

**Before the fix**

- `GALENA_XMPP_INTEGRATION=1 … vitest run src/integration.test.ts`, 8 runs in a row: **6 failed**, 2 passed. Example failure: `AssertionError: expected 'reconnecting' to be 'online' // Object.is equality`.
- ejabberd log for those runs:
  ```
  [warning] core-alice-…@galena.localhost/galena-… acknowledged 2 stanzas, but only 1 were sent
  [info] Closing c2s session for core-alice-…: Stream closed by local host:
         Client acknowledged more stanzas than sent by server (undefined-condition)
  ```
- The required reproduction `src/integration-sm.test.ts`, run with the fix disabled: **failed on the first attempt** (20 s / 120 stanzas):
  ```
  AssertionError: expected [ …(2) ] to deeply equal []
      expect(alice.unexpected).toEqual([]);
  [warning] sm-bob-…@galena.localhost/galena-… acknowledged 2 stanzas, but only 1 were sent
  ```

**After the fix**

- Existing integration test `src/integration.test.ts`, **10 consecutive runs: 10 passed, 0 failed**; no SM warnings in the window (`docker compose … logs --since 4m` → empty).
- Required reproduction `src/integration-sm.test.ts`, 3 consecutive runs at the spec's size:
  ```
  RUN 1 PASSED: PASS  two clients stayed online for 60s; sent 466 stanzas, received 666 messages; no stream-management ack errors
  RUN 2 PASSED: PASS  two clients stayed online for 60s; sent 466 stanzas, received 666 messages; no stream-management ack errors
  RUN 3 PASSED: PASS  two clients stayed online for 60s; sent 466 stanzas, received 666 messages; no stream-management ack errors
  PASSED 3/3
  ```
- `pnpm install`: PASS.
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors … 191 files with 127 rules".
- `pnpm typecheck`: PASS — turbo "8 successful, 8 total"; `@galena/xmpp-core` runs `tsc --noEmit && tsc --noEmit -p tsconfig.integration.json`, both clean.
- `pnpm test`: PASS — turbo "8 successful, 8 total"; `@galena/xmpp-core`: **94 passed, 2 skipped** (both integration files skipped by default).
- `pnpm build`: PASS — turbo "2 successful, 2 total".
- `pnpm infra:up && GALENA_XMPP_INTEGRATION=1 pnpm --filter @galena/xmpp-core test; pnpm infra:down`: PASS — **7 files, 96 passed** (both integration tests, the 60 s one included); `infra:down` removed containers and network, volumes kept.
- No-Node-types check: `tsc --noEmit --listFiles -p packages/xmpp-core/tsconfig.json` → 0 `@types/node` files, and neither `integration.test.ts` nor `integration-sm.test.ts` is listed.

### Problems, deviations from the spec, open questions

1. **Fix shape.** The spec's preferred fix is to correct the counter through the public `streamManagement` object. I read `client.streamManagement` (to no-op when it is absent) but the actual correction is our own XEP-0198 counter written into the outgoing `<a/>`/`<resume/>` by wrapping `client.send`. That is still a source-only workaround with no `node_modules` patch and no dependency change, and it keeps stream management **enabled**.
2. **The failure is timing dependent.** It depends on `<enabled/>`, a pre-enable stanza and the first `<r/>` landing in one parser batch, so it is intermittent (see the 6/8 before and 10/10 after). The reproduction test is therefore run repeatedly in the Report rather than once.
3. **Second xmpp.js bug, fixed along the way.** IQ replies are never counted by xmpp.js's own middleware (the IQ caller short-circuits `next()`), so its `h` also lags on normal traffic. The new counter is driven by the raw `element` event and counts them like the server does. This is a correctness improvement, not a change of scope.
4. **`afterOnline` still sends presence before `<enable/>`.** With the counter fix this is harmless and matches the XEP order (binding is complete). I did not reorder it; say the word if you would rather serialize the post-login sends behind `<enabled/>` as well.
5. **Dev stack.** Used `pnpm infra:up` / `infra:down` only (no reset). `infra/.env` already existed in this worktree.

### Blocked / needs a decision

- Nothing blocked. One decision for review: finding 1 above (own counter + `send` wrapper instead of overriding `streamManagement` itself) and finding 4 (whether to also defer the post-login sends).


---

## Review (written by Claude)

**Verdict:**

### Findings
-
