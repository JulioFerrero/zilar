---
id: T-0027
title: Mobile — real chats: the phone shows real DMs and groups via xmpp-core, with history, typing, receipts and live updates
status: review
milestone: M1
branch: task/T-0027-mobile-real-data
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0004, T-0024, T-0025, T-0026]
estimate: 2 days
---

# T-0027: Mobile on real data

## Spec (written by Claude, do not edit)

### Goal
This is the last piece of M1. The phone can sign in (T-0026) and we have proven
`xmpp-core` runs on iOS (T-0004), so now the mobile app stops using mock chats
and shows **real** DMs and groups, with history, typing, read ticks, online
status and live updates — the same behaviour the web has had since T-0024.

Julio should be able to open Zilar on his phone, see a real conversation, send a
message and see it arrive on the other side.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md`
- **`apps/web/src/store/realStore.ts`** — this is the reference implementation.
  Mirror its behaviour. Do not invent a different shape.
- `packages/xmpp-core/src/**` and `packages/chat-core/src/**` — the shared
  packages. **Consume them; never duplicate their logic in the app.**
- `apps/mobile/src/auth/**` (T-0026: `useSession`, secure storage) and
  `apps/mobile/src/store/chat-store.ts` (the `ChatStore` interface to keep)
- The Review of `work/T-0025-real-use-fixes-1.md` — the live bugs it fixed. Four
  of them are in the list below and they are all real.
- The Review of `work/T-0004-expo-xmpp-spike.md` — what the spike proved, and
  the two global shims the app must install

### Allowed files
- `apps/mobile/src/store/**`, `apps/mobile/src/lib/**`, `apps/mobile/src/app/**`,
  `apps/mobile/src/components/**`
- `apps/mobile/src/types/**`
- `apps/mobile/package.json` and `pnpm-lock.yaml` **only** if genuinely needed
- `work/T-0027-mobile-real-data.md`

**Not allowed:** `packages/**`, `apps/server/**`, `apps/web/**`, and
**`apps/mobile/metro.config.js`** — it was just fixed for xmpp-core and must not
be touched. If you believe you need a change there, write it in the Report and
stop.

> Other workers have edited `pnpm-lock.yaml`. Do not resolve a lockfile conflict.

### What to build
1. **A real store on mobile** implementing the same `ChatStore` interface the
   components already use, so the components barely change — exactly as T-0024
   did on the web:
   - on load: `GET /api/chats` and `GET /api/me`; then connect `xmpp-core`, with
     `getToken` calling `POST /api/xmpp/token` using the session from T-0026;
   - join every group room, and load each chat's last message
     (`loadHistory(chatJid, kind, { max: 1 })`) for the preview and the sort;
   - opening a chat loads 50 messages and paginates older ones on scroll-up;
   - live messages, typing, displayed markers and group online counts from
     xmpp-core events; contact presence for the DM online dot;
   - a "Connecting…" / "Waiting for network…" bar while not online, like most messengers;
   - unread counts kept per chat, `markDisplayed` sent when a chat is open and a
     new message arrives.
2. **Install the two shims the T-0004 spike proved are needed** — `process.nextTick`
   and `crypto.randomUUID` — at app start, and keep a `?mock=1` dev mode with the
   existing mock store. The mock store must not ship as the default.
3. **Four bugs from T-0025, which the phone will otherwise inherit:**
   - **Never show a JID localpart as a name.** Resolve through contacts, then the
     message `fromNick`, then the group member list, then the room occupant, and
     finally "Someone". In typing indicators too.
   - **Ignore your own typing and your own displayed markers in groups.** Use the
     `outgoing` flag that `TypingEvent` and `DisplayedEvent` now carry — do not
     compare JIDs, because an unresolved MUC sender arrives as the full room JID.
   - **The chat-list row and the bubble must always agree on status.** When a
     message goes `sending → sent → read`, update the list preview too.
   - **Status must be monotonic**: a late echo must never downgrade a message the
     peer already read.
4. **Reconnect on foreground.** Listen to `AppState` and, on `active`, reconnect
   if the status is not `online`. The T-0004 probe found the *simulator* does not
   suspend the socket; a real device will, so do not assume the socket is alive.
5. **Tests** (Vitest, a fake `fetch` and a fake `XmppCore`): loading chats and
   sorting; a live message updating preview and unread; opening a chat clearing
   unread and sending `markDisplayed`; optimistic send then confirm; pagination;
   the connecting bar; a fresh token on reconnect; `AppState` active reconnecting;
   and the four T-0025 cases above.

### Integration check (you run it against the running stack)
The dev stack is **already running and serving Julio** (server `127.0.0.1:3188`,
ejabberd `ws://127.0.0.1:5280/ws`). A gated test (`ZILAR_MOBILE_XMPP=1`) that
signs in through the real server, connects `xmpp-core`, joins a room, sends and
receives a message, and reconnects with a fresh token. Paste the output.

**Never** run `pnpm infra:up`, `infra:down` or `infra:reset`, and never stop a
process you did not start. A copy of `infra/.env` is in your worktree: use it as
it is, never print its values, never look outside the worktree. **Never paste a
token, a 6-digit code or an invite code** into the Report or a screenshot.

Run the app with `npx expo run:ios --no-bundler` plus Metro in the background and
**stop Metro at the end**. Screenshots go in `apps/mobile/screenshots/`. If the
simulator is busy, say so and stop rather than taking it over.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test`, `build` pass.
- [ ] A committed screenshot of the phone showing a **real** conversation with a
      real contact, not `?mock=1`.
- [ ] The integration output is in the Report, redacted.
- [ ] No JID localpart is ever rendered as a name.
- [ ] `metro.config.js` is untouched and no new dependency was added without a
      line in the Report explaining it.
- [ ] Only allowed files touched.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Out of scope
- Push notifications (T-0005).
- AI desks, listeners, AI profiles — that is M2.
- Voice recording on mobile (`expo-audio`); T-0010 did the web side.
- Any change to `metro.config.js`, `packages/**` or the server.

---

## Report (written by the worker when done)

### What I did

**1. The real store (`apps/mobile/src/store/real-store.ts`).** A vanilla
zustand store that implements the mobile `ChatStore` interface and mirrors the
web `apps/web/src/store/realStore.ts`:
- `boot()` loads `GET /api/me`, `GET /api/chats`, `GET /api/contacts`, connects
  `xmpp-core` with `getToken` calling `POST /api/xmpp/token` (the token from
  boot is reused once, then a fresh one per reconnect), joins every group room
  and loads each chat's last message with `loadHistory(chatJid, kind, {max: 1})`,
  then sorts by recency.
- `openChat` loads 50 messages and sends `markDisplayed`; `loadOlder` pages
  older history with `before`; `hasMore` follows `historyComplete`.
- Live messages, typing, displayed markers, room occupants (group online
  counts) and contact presence (the DM online dot) all come from xmpp-core
  events.
- Group invites / roster pushes trigger a debounced `/api/chats` refresh that
  joins new rooms and loads their preview.
- The four T-0025 fixes are carried over: the name ladder never falls back to a
  JID localpart (`contacts → fromNick → group member list → room occupant →
  DM title → "Someone"`, in typing too); own typing/displayed are dropped using
  the `outgoing` flag (plus the JID check); one `updateMessageStatus` helper
  keeps the bubble and the list preview in agreement; statuses are monotonic
  (`sending → sent → read`).
- Reconnect on foreground: `start()` subscribes an injected `AppStateLike` and
  on `active`, when the status is not `online`, calls `connect()` again (or
  re-runs `boot` if there is no core yet).

**2. The API client (`apps/mobile/src/lib/chat-api.ts`).** Hand-validated
(mobile has no zod; this follows the `auth-api.ts` style) bearer-`fetch`
wrappers for `/api/me`, `/api/chats`, `/api/contacts`, `/api/groups/:id` and
`/api/xmpp/token`, with a typed `ChatApiError`. The session token is read from
secure storage through `lib/session-token.ts` (a dynamic `expo-secure-store`
import so Vitest/Node can load the module).

**3. App wiring.** `store/chat-store-provider.tsx` creates the real store by
default and the mock store in `?mock=1` / `EXPO_PUBLIC_ZILAR_MOCK=1` mode,
starts it when the T-0026 session is `authenticated`, injects React Native's
`AppState`, and exposes the `useChatStore` selector hook. The chat screens
(`app/index.tsx`, `app/chat/[id].tsx`, the list item, header and message list)
now import `useChatStore` from the provider; `_layout.tsx` installs the
polyfills and wraps the `Stack` in the provider.

**4. Polyfills.** `lib/polyfills.ts` installs the two shims the T-0004 spike
proved are needed (`process.nextTick`, `crypto.randomUUID`) conditionally, and
is imported first in `_layout.tsx`.

**5. UI.** A thin "Connecting…" / "Waiting for network…" bar
(`lib/connection.ts` + `app/index.tsx`) shows while the status is not `online`.
`MessageList` loads older history when scrolled to the top, and `Composer`
sends a composing chat-state while typing.

**6. Tests.** `store/real-store.test.ts` (18), `lib/chat-api.test.ts` (5),
`lib/connection.test.ts` (2), all with a fake fetch/fake `XmppCore`/fake
`AppState`. `store/integration.test.ts` is the gated live check.

### Files changed

- New: `apps/mobile/src/store/{real-store.ts,real-store.test.ts,types.ts,chat-store-provider.tsx,integration.test.ts}`, `apps/mobile/src/lib/{chat-api.ts,chat-api.test.ts,session-token.ts,polyfills.ts,connection.ts,connection.test.ts}`.
- Modified: `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/app/{_layout.tsx,index.tsx,chat/[id].tsx}`, `apps/mobile/src/components/chat/{chat-list-item.tsx,chat-header.tsx,message-list.tsx,composer.tsx}`, `work/T-0027-mobile-real-data.md`.
- No `packages/**`, `apps/server/**`, `apps/web/**` or `metro.config.js` change. No dependency added; `pnpm-lock.yaml` untouched. `apps/mobile/src/spike/**` was left alone because it is outside the Allowed files.

### Commands run and real results

- `pnpm install`: PASS — "Done in 11.3s".
- `pnpm format:check`: PASS — "All matched files use Prettier code style!" (after `pnpm format`; only the files above changed).
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors" (291 files, 127 rules).
- `pnpm typecheck`: PASS — turbo "8 successful, 8 total".
- `pnpm test`: PASS — turbo "8 successful, 8 total". `@zilar/mobile` **102 passed, 2 skipped** (15 files + the 2 gated integration files); `@zilar/web` **85 passed**; `@zilar/server` **186 passed, 3 skipped**. New mobile tests: `real-store` 18, `chat-api` 5, `connection` 2.
- `pnpm build`: PASS — 2/2 tasks; Expo exported the iOS and Android bundles (`entry-*.hbc`, 7.4 MB / 7.6 MB).
- `ZILAR_MOBILE_XMPP=1 pnpm --filter @zilar/mobile test integration`: **not run** (see below). It is collected and skipped by default (shown as `1 skipped`).
- Note on `pnpm test --force`: an uncached run in parallel with the other worktrees flaked two heavy web component tests (`MessageActions.test.tsx`, `ChatShell.test.tsx`) with 5 s timeouts. Re-run alone, `pnpm --filter @zilar/web test` is **85 passed** and `pnpm --filter @zilar/server test` is **186 passed, 3 skipped**. I did not touch web, so this is CPU contention, not a regression.

### Problems, deviations from the spec, open questions

- **The gated live integration was not executed.** The test is written
  (`apps/mobile/src/store/integration.test.ts`): it signs in through the real
  server (reading the OTP from the server's own log, never a response), calls
  the production `createChatApi` for `/api/me` and a fresh `POST
  /api/xmpp/token`, connects `@zilar/xmpp-core`, creates and joins a room,
  sends a group message and waits for the room echo, then reconnects and
  asserts `getToken` fired a second time. It needs
  `ZILAR_AUTH_INTEGRATION_LOG`, `ZILAR_AUTH_INVITE_CODE` and
  `ZILAR_MOBILE_TEST_EMAIL`; this worktree has no `apps/server/.env` and no
  such values, and I must not read secrets or change the running stack, so I
  could not produce the requested output. Run:
  ```bash
  ZILAR_MOBILE_XMPP=1 \
  ZILAR_AUTH_INTEGRATION_LOG=<server log> \
  ZILAR_AUTH_INVITE_CODE=<fresh invite> \
  ZILAR_MOBILE_TEST_EMAIL=<new email> \
  pnpm --filter @zilar/mobile test integration
  ```
- **No real-conversation screenshot.** The only booted simulator is the lead's
  "iPhone 17 Pro" and it currently shows a pending "Open in Zilar?" dialog
  (the same one T-0026 noted). Its installed Zilar build is older and lacks
  the `ExpoSecureStore` native module, so it cannot run this JS at all
  (`Cannot find native module 'ExpoSecureStore'`). Per the spec I did not take
  it over. I started Metro only to probe, then stopped it (port 8081 is free)
  and deleted the probe screenshot. A screenshot needs a machine with the
  SecureStore build and a signed-in session.
- **`lastRead` is kept in memory only.** Mobile has no synchronous storage (the
  session token uses `expo-secure-store`, which is async and keychain-only), so
  unread counts are per session and reset on restart. The spec's mobile wording
  only asks for unread counts and `markDisplayed`; persistence would need a new
  dependency, which the spec does not list.
- **`?mock=1` on native** is read from expo-router's global search params (and
  `EXPO_PUBLIC_ZILAR_MOCK=1`); the real store remains the default.
- **The spike was not deleted** (`apps/mobile/src/spike/**` is outside the
  Allowed files), so `lib/polyfills.ts` re-implements its two shims instead of
  importing them.
- **Pagination/typing wiring** needed small `MessageList`/`Composer` changes
  (scroll-to-top → `loadOlder`, typing chat-state); the components otherwise
  changed only their `useChatStore` import.

### Blocked / needs a decision

- Only the two live items above: the integration output and the real
  screenshot. Both need the lead's environment (server log + a fresh invite, and
  a SecureStore-capable simulator with a session). The code and all unit checks
  are complete; if the lead provides the env I can run the integration and
  capture the screenshot.

### Round 2 (findings 1-2)

**Finding 1 — the gated integration test now mirrors the store's token flow.**
The old test called `api.getXmppToken()` itself *and* fetched again inside the
`getToken` handed to `createXmppCore`, so `connect()` made two network calls.
`store/integration.test.ts` now does what `real-store.ts` does:
- pre-fetch one token (`const firstToken = await api.getXmppToken()`, network
  call 1),
- `getToken` serves that value on the first call and only hits
  `POST /api/xmpp/token` on later (re)connects,
- assert `tokenNetworkCalls === 1` right after the initial `connect()`, and
  `=== 2` after `disconnect()` + `connect()`.

**Integration run (redacted), against the running stack:**
```
[mobile xmpp integration] sign-in through the real server → 200 →
  GET /api/me → USER***@zilar.localhost →
  POST /api/groups → 201, room ROOM***@rooms.zilar.localhost →
  xmpp-core online as USER***@zilar.localhost →
  joined the room → sent and received a group message →
  reconnect fetched a fresh token (getToken network calls: 2)

 ✓ src/store/integration.test.ts (1 test) 911ms
   ✓ mobile XMPP integration (real server) (1)
     ✓ signs in, connects xmpp-core, joins a room, sends and receives, then reconnects
 Test Files  1 passed (1)
      Tests  1 passed (1)
```
The invite code, the 6-digit OTP and the room/user localparts are redacted; the
test reads the OTP from the server's own log and never prints a token.

**Finding 2 — the spike is deleted.**
- Removed `apps/mobile/src/spike/` (`config.ts`, `fetch-token.ts`,
  `polyfills.ts`, `spike-screen.tsx`, `spike.test.ts`) and
  `apps/mobile/src/app/spike.tsx` (5 files + 1 route = 6 files).
- `lib/polyfills.ts` is now the single copy of the two shims, so there is
  nothing to drift.
- Removed the dangling `spike/config.ts` pointer from the `lib/auth.ts` comment,
  and reworded the two remaining mentions of "spike" in comments
  (`lib/polyfills.ts`, `lib/xmpp-node-stubs/empty.js`). `grep -r spike
  apps/mobile/src` now returns nothing.
- `metro.config.js` is **untouched**; the stub it resolves
  (`src/lib/xmpp-node-stubs/empty.js`) still exists and is unchanged. `pnpm build`
  bundled iOS + Android after the deletion, so the bundle still resolves.
- The mobile test count drops by the spike's 8 tests (102 → 94 passed).

### Round 2 commands run and real results

- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors" (285 files, 127 rules).
- `pnpm typecheck`: PASS — turbo "8 successful, 8 total".
- `pnpm test`: PASS — turbo "8 successful, 8 total"; `@zilar/mobile`
  **94 passed, 2 skipped** (the two gated integration files skipped by default).
- `pnpm build`: PASS — 2/2 tasks; Expo exported the iOS and Android bundles.
- `ZILAR_MOBILE_XMPP=1 … pnpm --filter @zilar/mobile test src/store/integration.test.ts`:
  PASS — 1/1 (911 ms), output above.



---

## Review (written by Claude)

**Verdict:** Round 2: changes requested. The code is good and the four carried-over
bugs are genuinely fixed. **The live integration test fails**, and the lead found
that by running the thing you could not.

### What the lead verified
- **I ran your gated integration test against the live stack**, which you could
  not, and it **fails in 370 ms**:
  ```
  AssertionError: expected 2 to be 1 // Object.is equality
    ❯ src/store/integration.test.ts:259:26
      259|       expect(tokenCalls).toBe(1);
  ```
  Everything before it passed: it signed in, created a group through
  `POST /api/groups` and got a room. So the live path works; the assertion is
  wrong. See Finding 1.
- **All four T-0025 fixes are present and correct.** I read them rather than
  trusting the Report:
  1. `real-store.ts:285,398` use the `outgoing` flag for own typing/markers, not
     a JID comparison — so the unresolved-MUC-sender case is handled.
  2. The localpart is used **only as a lookup key** (lines 240–266, with a
     comment saying it is never shown) and the ladder ends at `'Someone'`
     (line 307). No JID localpart can reach the screen.
  3. `updateMessageStatus` applies `advanceStatus` to the message **and** to
     `chat.lastMessage` when they match, so the row and the bubble cannot
     disagree.
  4. `advanceStatus` makes the ladder monotonic, so a late echo cannot downgrade
     a message the peer already read.
- **Unit checks.** My first `pnpm test` FAILED with three `apps/web` timeouts
  (`MessageActions` 5420 ms, `TypingIndicator` 5591 ms, `ChatShell` 6399 ms) in
  a package this task never touches. I isolated it rather than reporting it as
  yours: `apps/web` alone is **85/85**, and those three files together are
  **9/9**. They are load-sensitive timeouts from the full parallel suite, the
  same class as the one the T-0010 review filed. I have broadened that board
  follow-up from one test to three. Not a finding against this task.
  `format:check`, `typecheck` and `build` PASS; `lint` exits 0.
- **The two things you could not do, and why I accept them:** the simulator was
  genuinely unavailable (only the iPhone 17 Pro was booted, with a pending system
  dialog and an older build lacking `ExpoSecureStore`) — refusing to take it was
  the right call, and it is in the Spec. `lastRead` in memory only is disclosed
  and reasonable: the Spec did not list a storage dependency, and the session
  token is keychain-only by design.

### Findings
1. **The gated integration test is wrong and would fail for anyone who ran it**
   (`apps/mobile/src/store/integration.test.ts`). You counted the token endpoint
   twice: once for your own `await api.getXmppToken()` at line 222, and again
   inside the `getToken` you hand to `createXmppCore`, which `connect()` calls
   immediately. So `tokenCalls` is already 2 at line 259.

   Worse, the test does not exercise what the store actually does. The real
   `real-store.ts:810` pre-fetches one token and hands it back from
   `getToken` without a second network call — the store is right and the test
   does not model it. Fix the test to mirror the store: pre-fetch once, serve
   the first `getToken` from that value, and assert **exactly one** network call
   for the initial connect, then that the reconnect fetches a fresh one. Then
   run it and paste the output. A gated test that has never been executed is
   worse than no test, because it looks like evidence.
2. **Delete the spike now** (`apps/mobile/src/spike/**`). You had to re-implement
   the two shims in `lib/polyfills.ts` because the spike is outside the Allowed
   files, so the app now carries **two copies** of the same shims that will drift.
   The spike has done its job — T-0004 is merged and this task is the real thing.
   Delete `src/spike/` **and** `src/app/spike.tsx`, and say in the Report what you
   deleted. Nothing may reference them afterwards; check that the bundle still
   resolves, because `metro.config.js` must not be touched to achieve it.
3. *(No change needed.)* `?mock=1` read from expo-router's global params, with
   `EXPO_PUBLIC_ZILAR_MOCK=1` as the native equivalent and the real store as
   the default. Correct, and the mock does not ship as the default.
4. *(No change needed.)* The `MessageList`/`Composer` changes for pagination and
   typing chat-state, with components otherwise only swapping their
   `useChatStore` import. That is the right size of change.

### Follow-up for the lead, not this task
- The remaining acceptance item is a screenshot of a real conversation. I can
  take the simulator now that I know it is free, but it needs a signed-in
  session on a build with `ExpoSecureStore`. If the code merges first, the next
  task can capture it; the unit and live tests are the stronger evidence and
  they now pass.

### Round 2 review (2026-09-28 09:28) — **approved, merged**

Both findings are fixed. I verified the code and then ran the gated test myself,
because the whole point of the finding was that this test had never been
executed.

### What the lead verified
- **The integration test now passes live, on my own run** — not on the worker's
  word. I minted a fresh invite (the previous one had been consumed) and ran it
  against the running stack on `127.0.0.1:3188`:
  `apps/mobile/src/store/integration.test.ts` → **1 passed (1)**, not skipped.
  That covers sign-in, `GET /api/me`, `POST /api/groups`, xmpp-core coming
  online, joining the room, a group message going out and coming back, and the
  reconnect fetching a fresh token. The assertion that failed at
  `integration.test.ts:259` in round 1 is gone, and the token call is now
  counted the way the store actually makes it.
- **The spike is deleted.** `apps/mobile/src/spike/` and
  `apps/mobile/src/app/spike.tsx` are both absent. The only remaining mention of
  the word anywhere under `apps/mobile` is a comment in `metro.config.js:31`
  explaining that the node-stub is permanent and guarded by `existsSync` — which
  is the fix I made in T-0004 and must not be undone. `metro.config.js` itself
  was not touched, as required.
- **The four T-0025 fixes all carried over correctly** and I re-checked them in
  the diff rather than assuming: the `outgoing` flag (not a JID compare) gates
  own typing/markers; the localpart is only a lookup key and the name ladder ends
  at `'Someone'`; `updateMessageStatus` advances both the bubble and
  `chat.lastMessage`; `advanceStatus` is monotonic.
- The three `apps/web` timeouts were load sensitivity, not a regression — already
  isolated by the worker and already broadened on the board.

### Accepted as stated
- `lastRead` is in-memory only for now. The Spec listed no storage dependency and
  the session token is deliberately keychain-only, so this is the right size of
  change. It is a real follow-up, not a defect.

### Follow-ups carried to the board
- Screenshot of a real conversation on a SecureStore build — the remaining
  acceptance item, and the next task can take it with a free simulator.
- `apps/web` load-sensitive tests (`MessageActions`, `TypingIndicator`,
  `ChatShell`) — needs fake timers or an explicit longer timeout, not a retry.
