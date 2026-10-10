# I-packages: shared packages and the runner

## 1. Summary

1. **The Promise facade is cheap; X8 buys little.** `packages/xmpp-core/src/client.ts` is 42 lines of `Effect.runPromise(core.x())`. The `XmppCore` interface in `types.ts:~240-330` is about 90 more. There is no behaviour drift: every facade method is a 1:1 `runPromise`. Deleting it removes roughly 130-200 production lines. The real cost is on the consumer side: 65 `fromPromise` wrappers in web (`apps/web/src/store/effects/*`) plus `lift` in mobile, about 55 production call sites, 17 test files with 11+ hand-rolled `fakeCore()` copies, and a 234-line `FakeCore` in `gateway.test.ts:74-233`.
2. **The "a tick late" concern is real and is a reason to keep `on()`.** `events.ts:70-75` says it outright: `on` callbacks run synchronously inside `emit` in subscription order, while `Stream.fromPubSub` consumers run on a fiber. Consumers (`lifecycle.ts`, web and mobile) depend on that ordering. Moving event subscription to Streams changes semantics. Moving method calls to Effects does not. Recommendation: do X8 in that narrower form (methods to Effect, keep sync `on`), and do not delete `on`.
3. **`packages/agent-drivers` has zero consumers.** It is in no `package.json`, and nothing imports `@zilar/agent-drivers` (grep over apps and packages is empty). It is 1,610 lines (573 driver, 186 fake server, about 725 tests). It is a candidate for deletion or archiving, but needs Julio's call (see Q1).
4. **Fake cores are the biggest test cost, not the facade.** One shared `createFakeXmppCore()` exported from xmpp-core (a `./testing` entry) could replace `FakeCore` (160 lines in gateway.test.ts), 11 `fakeCore()` copies in mobile and the web inline fakes. Estimated saving 400-700 test lines, and it makes X8 cheap, because only one fake changes.
5. **JID, handle and mention logic is duplicated across the server and the apps.** The server does not depend on chat-core. `bareJid` is re-implemented in 5 server files (`agents/context.ts:40`, `agents/memory/indexer.ts:79`, `search/routes.ts:122`, `media/api.ts:174`, `push/service.ts:554`). `xmpp-core/src/jid.ts` already exports `bareJid`, `jidDomain` and `jidLocalPart`, but `index.ts` does not export them. About 25 more inline `split('/')[0]` and `indexOf('@')` sites exist. Handle rules are copied 3 times (`apps/web/src/lib/handles.ts`, `apps/server/src/handles/rules.ts`, `apps/mobile/.../profile-logic.ts:134`) and kept equal only by a test asserting the list.
6. **Web and mobile stores duplicate pure logic.** About 8.2k and 7.8k non-test store lines. 384 identical long lines exist across them (of about 1,900 distinct web lines, so at least 20%). Verbatim copies include `forwardedPayloadFor` and `forwardedUiFieldsFor`, with near copies of `mapMentions`, `ingestEdit`, `userLocalpartOf` and `domainOfJid`. These are pure functions of `UiMessage` and `Payload`, so they belong in chat-core.
7. **Packages are consumed as TS source** (`"exports": "./src/index.ts"`, no build, no paths). This is the right choice for a monorepo with tsx, Vite and Metro. Keep it.
8. **xmpp.js is a defensible choice.** The custom code on top is where the risk sits: `core-effect.ts` (1,207 lines) is one closure with 17 mutable `let`s, and `stanza.ts` (1,078 lines) holds the XEP parsing. A lighter client would mean rewriting SASL, resume and stream management, and the repo has already needed a fix for xmpp.js's SM `h` counter (T-0021). Keep xmpp.js.
9. **Runner and tunnel are small (2.7k and 4.2k lines including tests) and not over-built.** Two smells: `apps/runner` lists `@zilar/server` as a devDependency only for one e2e test, and runner-tunnel ships `demo.ts` (198 lines) and `test-harness.ts` (468) inside `src/`.

## 2. Measurements

Commands: `wc -l`, `grep -rn`, `comm`. Tests were not run (the rules forbid long processes).

| Package | Source + tests, lines | Notes |
|---|---|---|
| xmpp-core | 9,076 (src dir) | core-effect.ts 1207, stanza.ts 1078, types.ts 394, core.test.ts 1275, stanza.test.ts 1342 |
| chat-core | 3,102 | 60 exports; web and mobile consume it, the server does not |
| protocol | 2,077 | |
| agent-drivers | 1,610 | 0 importers |
| runner-tunnel | 4,197 | server.ts 614, runner.ts 646, mux.ts 471, test-harness.ts 468 |
| ui-tokens | 310 | used by web and mobile; both have a `tokens-drift.test.ts` |
| apps/runner | 2,738 | cli 340, pair 236, identity 234, e2e test 209 |

- Facade: `client.ts` 42 lines. Facade tests: `core.test.ts` has 52 `it(` but only 13 `createCore(` calls (one helper). Effect-API tests are `core-effect.test.ts` with 14 `it(`. Other suites reaching the facade: `requests.test.ts` (1 call), `connection-resilience.test.ts` (3 calls).
- Promise-core consumers: web `ctx.ts:96`, `groupMembers.ts:101`, `history.ts:111`, `lifecycle.ts:263`, `ports.ts:171,191,273`, `realStore.ts:214`. Mobile `ports.ts:40,70,120`, `runtime.ts:117,260`, `history.ts`, `groups.ts`, `lifecycle.ts:38`, `real-store.ts:241`. Server `gateway.ts:63`, `gateway/sessions.ts:26,124`, `gateway/contracts.ts:46,190`.
- Call sites (production, grep over `core|current` method calls): web 25, mobile 26, server agents 16. `sendMessage` sites: web `send.ts:137,209,273,386,444`, mobile `send.ts:157,240,290,317,369`, server `live.ts:48,93`. Event subscriptions: 10 in each of the web and mobile `lifecycle.ts`, 3 in server `sessions.ts:143-149`.
- Wrappers: `fromPromise` 65 uses in `apps/web/src/store/effects`. The definition is `util.ts:5`. Mobile has `lift` at `runtime.ts:26`. The server has an `attempt()` wrapper in `sessions.ts` and `Effect.promise` in `live.ts`.
- Test fakes: `createXmpp` appears 66 times in web and mobile tests, in 17 files. `fakeCore()` copies are in 11 mobile test files. `apps/server/src/agents/gateway.test.ts` is 7,242 lines in total.
- Store overlap: non-test store lines are web 8,155 and mobile 7,754. Identical lines longer than 50 characters shared by both: 384.
- JID helpers: 5 server-local `bareJid` copies (listed in the summary), plus `mentionLocalpart` at `realStore.ts:202`, `domainOf` at `groupMembers.ts:13`, `domainOfJid` at `mobile/lib/contacts-api.ts:370`, `isAiJid` in chat-core and a hand-rolled `startsWith('ai-')` at `server/agents/gateway/contracts.ts:234` and `web/TaskStrip.tsx:156-160`.

## 3. Findings, ranked by value over effort

### F1. Shared fake core for tests (and a prerequisite for X8)
- Evidence: `gateway.test.ts:74-233` (160-line `FakeCore implements XmppCore`); 11 `fakeCore()` functions in `apps/mobile/src/store/real-store.*.test.ts` (for example `real-store.invite-links.test.ts:41-57` returns `unknown`); `effects/events.test.ts:35`, `pins.test.ts:34`, `groups.test.ts:31`; web `realStore*.test.tsx` and `reload.test.tsx`.
- Impact: 400-700 test lines removable (11 fakes at about 17 lines, plus FakeCore, plus the web fakes). A single point to change when the core API changes.
- Risk: low. Tests are the safety net. Many fakes return `unknown`, so type-checking never verifies them against the real interface. That hides drift today.
- Effort: M (1-2 days, can be split web / mobile / server).
- Recommendation: add `packages/xmpp-core/src/testing.ts` with `createFakeXmppCore(overrides)` (records calls, `emit(event, payload)`, configurable failures), exported as `@zilar/xmpp-core/testing`. Migrate one app per task. Do this before X8.

### F2. Do X8 in a narrower form: methods to Effects, keep `on()`
- Evidence: `events.ts:70-75` (synchronous `on`, the reason for it); `core-effect.ts:222` (`CoreEffect = XmppCoreEffect & { on }`, so the Effect core already carries the sync `on`); `client.ts` is a pure `runPromise` map.
- What it would take:
  1. Types: change ports (`web ports.ts:171,191`, `mobile ports.ts:40,70`, `server gateway/contracts.ts:46,190`, `sessions.ts:26`) to `CoreEffect`, with `createXmppCore` removed and `createXmppCoreEffect` plus `on` exported.
  2. Consumers: replace `fromPromise(() => current.x())` with `current.x()` at about 55 sites (list in section 2). This also gives typed errors (`NotOnline`, `XmppCoreError`) instead of `unknown`, and removes the 65 wrappers.
  3. Fire-and-forget: `sendTyping` and `markDisplayed` are `void` in the facade and `Effect<void>` in the Effect API. Call sites (`incoming.ts:162`, `history.ts:233`, `messageActions.ts:179`, mobile `send.ts:333`, `history.ts:345`, `real-store.ts:1688`, server `live.ts:152,164`) need `ctx.rt.runDetached(...)`.
  4. Tests: swap the 17 test files' fakes, ideally after F1. `core.test.ts`, `requests.test.ts` and `connection-resilience.test.ts` need a one-line helper (`run = Effect.runPromise`), since they call the factory only 17 times.
  5. Delete `client.ts`, the `XmppCore` interface (keep a `Pick` type for `on`), and the facade exports in `index.ts`.
- Impact: about 130-200 production lines plus roughly 100-200 wrapper lines in the apps. The gain is mainly consistency and typed errors, not size.
- Risk: medium. The messaging path is the product; the server gateway `attempt()` wrappers swallow some errors on purpose (`sessions.ts:72,159,208,255,300`). Changing the failure channel from `unknown` to typed can change which `catch` branch fires. Keep `on()` synchronous. Do not convert event consumption to `events.*` Streams: that changes ordering ("a tick late") and a throwing handler would kill the consumer fiber (`events.ts:71-74`).
- Effort: L (3-5 days, split per app: server gateway first, as the smallest, then mobile, then web).
- Verdict: worth doing after F1, but it does not remove the "two APIs" problem fully, because `on` stays. Alternative: keep the facade and stop calling X8 a debt. If the two-API cost worries Julio, the cheaper cut is to delete the unused PubSub streams (below).

### F3. The `events` Streams may be unused, which would make the dual event system pure overhead
- Evidence: `events.ts:40-100` creates 10 unbounded PubSubs and 10 Streams for every core, and `emit` publishes to them even with no subscriber (`PubSub.publishUnsafe`). The only consumers of `.events` I found are in `core-effect.test.ts`. grep: no `core.events` in apps. UNVERIFIED for dynamic access, but static search showed none.
- Impact: about 50 lines plus `EventStreams` types, and some work per event (publishing on an unbounded PubSub without subscribers is cheap, but it is still dead path). The `emit` of high-rate events (typing, presence) allocates for nobody.
- Risk: low. Effort: S.
- Recommendation: if no consumer is planned, delete the PubSubs and the `events` field and keep only the `on` hub. If Streams are wanted later, add them back when the first consumer exists (YAGNI). Check with Julio, since the Effect-everywhere plan may intend them (Q2).

### F4. Delete or park `packages/agent-drivers`
- Evidence: not in any `package.json` dependency; no imports (grep). Last real work was T-0499; `PROJECT_PLAN.md:843` says "Live-tested against OpenCode v2". The server's AI path goes through its own gateway, not this driver.
- Impact: 1,610 lines, a workspace package, a vitest run in the gate, and one Tier B file in the Effect ratchet.
- Risk: low, but it may be future-planned for the runner/desk work (the `types.ts` header says "inside a desk").
- Effort: S.
- Recommendation: ask Julio; if no near-term plan, `git rm` the package (history keeps it, tag the commit).

### F5. Centralise JID helpers and use them on the server and in the apps
- Evidence: see the summary list. `jid.ts` helpers exist but are not exported from `xmpp-core/src/index.ts`. The server has `.toLowerCase()` variants in 4 files (`search/routes.ts:123`, `memory/indexer.ts:80`, `push/service.ts:554`, `media/api.ts:175`), so the semantic is "bare + lowercase". `isJid` in protocol (`common.ts:41`) accepts only bare JIDs.
- Impact: roughly 60-90 lines removable and 25 ad-hoc `split` sites made uniform; also removes a class of bugs (the `JidSchema` rejects resources while `bareJid` copies disagree on lowercasing).
- Risk: low; each helper is pure and has tests. The server must not import xmpp-core internals; better to place the helpers in `@zilar/protocol` (it has `isJid`, no xmpp.js dependency, and is already imported by both apps and the server), then re-export from xmpp-core.
- Effort: S-M (1 day plus sweeps).
- Recommendation: add `bareJid`, `jidLocal`, `jidDomain`, `normalizeJid` (bare + lowercase), `isAiJid` to protocol, make chat-core and xmpp-core re-export them, then replace the call sites in one sweep per app. Remove the hand-rolled `startsWith('ai-')` checks (`contracts.ts:234`, `TaskStrip.tsx:156-160`).

### F6. Move shared pure store logic from web and mobile into chat-core
- Evidence: `forwardedPayloadFor` and `forwardedUiFieldsFor` are verbatim (`web effects/send.ts:340-363`, `mobile real-store.ts:1249-1272`). `mapMentions` (`realStore.ts:1211`, `mobile real-store.ts:522`), `ingestEdit` (`realStore.ts:508`, `mobile real-store.ts:587`), `userLocalpartOf` (`realStore.ts:990`, `mobile real-store.ts:1288`), plus shared names such as `reactionChips`, `reactionsEqual`, `mentionsEqual`, `finishedTurnOrder`, `coreKind`, `authorOfChatMessage`, `editUpdateFor`, `applyReactionUpdate`, `applyEditUpdate`. In total `comm` of declared function names shows 301 names common to both stores (many are local variable names, so the real function overlap is smaller; UNVERIFIED count). 384 identical long lines exist.
- Impact: realistic 600-1,500 lines moved to one place (and half their tests merged). The store directories are about 16k non-test lines, so it is the largest duplication in my area.
- Risk: medium. These functions close over `get()`/`myJid()` in the stores; extraction means passing explicit args. A mistake changes chat behaviour. The existing store tests (14 + 14 files) are good coverage.
- Effort: L, but splittable into 6-8 small tasks (one function family each). Start with the verbatim ones (forwarding, reactions equality).
- Root cause: two UI shells were built in parallel with each owning a "real store"; chat-core stayed pure on `UiMessage` but never received the store helpers.

### F7. Handle rules triplicated
- Evidence: `apps/web/src/lib/handles.ts:11-25` says "mirror apps/server/src/handles/rules.ts exactly" and relies on `rules.test.ts` for sameness; `apps/mobile/src/components/settings/profile-logic.ts:134` has the same suggestion builder. 124 + 102 + 246 lines.
- Impact: about 150-200 lines.
- Risk: low. Effort: S.
- Recommendation: put `HANDLE_MIN_LENGTH`, `HANDLE_MAX_LENGTH`, `RESERVED_HANDLES`, `suggestHandles` and the validator into `@zilar/protocol` (it is already a dependency of all three). Server stays the authority.

### F8. core-effect.ts is a 1,207-line mutable closure behind an "Effect" API
- Evidence: 17 mutable `let`s at `core-effect.ts:233-262` (status, timers, tokens, pending connect). Internals call `Effect.runFork` from callbacks (e.g. 559, 576, 663, 688). The Effect surface is mostly a typed skin over callback state.
- Impact: clarity and testability: reconnect and keepalive rules (`reconnectDelayFor`, watchdog, keepalive) live in one function. It is split from stanza building (`stanza.ts`) and SM (`stream-management.ts`), which is good.
- Risk: high if rewritten (connection-resilience tests 576 lines are the net).
- Effort: L.
- Recommendation: do NOT rewrite into Refs and Layers. Instead extract the connection state machine (status, backoff, keepalive, watchdog) into its own module with pure `reconnectDelayFor`-style functions and an interface, leaving `core-effect.ts` for request/response logic. This is optional; only if a reconnect bug needs it.

### F9. Stanza parsing size and cost
- Evidence: `stanza.ts` is 1,078 lines, 41 exports, with a 1,342-line test. It builds with `xml()` from xmpp.js and reads xmpp.js elements. UNVERIFIED: no profile taken. Parsing happens once per stanza and is O(children), so per-message cost is small compared with xmpp.js's own XML parser. Not a hotspot.
- Recommendation: keep as is; consider splitting by XEP (messages, mam, muc, upload) when touched, since a 1k-line file hides the structure.

### F10. Package hygiene
- `apps/runner/package.json`: `@zilar/server` is a devDependency used only by `e2e.test.ts:5-13` through deep paths (`@zilar/server/src/app.ts`). This makes the runner depend on the whole server for one test. Move the e2e to `apps/server` or `packages/runner-tunnel`, or keep it and accept it (it is a devDependency only).
- `packages/runner-tunnel/src/demo.ts` (198) and `test-harness.ts` (468) live in `src/` and typecheck with the package; `test-harness.ts` is used by 10 imports (test files). Fine; rename to `*.test-support.ts` and drop `demo.ts` + the `demo` script if nobody runs it (UNVERIFIED).
- Export style differs: runner-tunnel's `index.ts` uses `.ts` extensions in specifiers, xmpp-core uses extensionless. Pick one (cosmetic).
- `chat-core/src/mentions.ts:4` mentions `@zilar/xmpp-core` in a comment only; the package.json is correct (no dependency).
- xmpp-core has `tsconfig.integration.json` for tests that need a live ejabberd (4 files, 750 lines: `integration*.test.ts`); they are excluded from the normal tsconfig (good), but check that they are skipped by `vitest run` without ejabberd (UNVERIFIED).

## 4. Things that look bad but should stay

- **Packages as TS source with no build or tsconfig paths.** One resolution path (`exports` -> `src/index.ts`) works for Vite, Metro (config 54 lines) and tsx. A build step would add a stale-dist failure mode.
- **The Promise facade at 42 lines.** It is harmless in itself. What hurts is the consumer wrappers and fakes, so fix those (F1, F2).
- **`on()` synchronous callbacks next to Streams.** Intentional; see `events.ts:70-75`.
- **xmpp.js (`@xmpp/client` 0.14).** About 800 KB unminified on disk across sub-packages, and the web bundle only gets what it imports (Metro blocks the Node transports through `metro.config.js:12-38`). Reimplementing WebSocket framing, SASL, SM resume and MUC would add far more risk than the dependency. The SM `h` bug (T-0021) is patched by 98 lines in `stream-management.ts`, which is the right size of patch.
- **Runner-tunnel's loopback socket bridge** (`http-agent.ts:5-12`): costs sub-millisecond per stream and keeps node HTTP behaviour (chunking, SSE) exact; do not replace with a hand-made socket.
- **chat-core being pure (no xmpp-core dependency).** Good boundary; the fix for duplication is to add to it, not to couple it.
- **Protocol `isJid` accepting bare JIDs only** (`common.ts:38`): by design.

## 5. Open questions for the owner

1. Is `packages/agent-drivers` (1,610 lines, no consumers) planned for the desk/runner work, or can it go?
2. Are the `events.*` Streams planned to be consumed (server gateway on Streams?). If not, delete them (F3).
3. For X8: is typed errors at call sites the goal, or just "no Promise"? If the goal is only "no Promise", F2 as narrowed (methods to Effect, `on` stays) is enough.
4. May the server import `@zilar/protocol` helpers for JID and handle rules (F5, F7)? It already depends on protocol.
5. Should store logic shared by web and mobile move into chat-core (F6) even though it is a large cross-cutting refactor? It touches messaging, which NOW.md says waits for Julio.
