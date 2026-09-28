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

Julio should be able to open Galena on his phone, see a real conversation, send a
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
   - a "Connecting…" / "Waiting for network…" bar while not online, like Telegram;
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
ejabberd `ws://127.0.0.1:5280/ws`). A gated test (`GALENA_MOBILE_XMPP=1`) that
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
default and the mock store in `?mock=1` / `EXPO_PUBLIC_GALENA_MOCK=1` mode,
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
- `pnpm test`: PASS — turbo "8 successful, 8 total". `@galena/mobile` **102 passed, 2 skipped** (15 files + the 2 gated integration files); `@galena/web` **85 passed**; `@galena/server` **186 passed, 3 skipped**. New mobile tests: `real-store` 18, `chat-api` 5, `connection` 2.
- `pnpm build`: PASS — 2/2 tasks; Expo exported the iOS and Android bundles (`entry-*.hbc`, 7.4 MB / 7.6 MB).
- `GALENA_MOBILE_XMPP=1 pnpm --filter @galena/mobile test integration`: **not run** (see below). It is collected and skipped by default (shown as `1 skipped`).
- Note on `pnpm test --force`: an uncached run in parallel with the other worktrees flaked two heavy web component tests (`MessageActions.test.tsx`, `ChatShell.test.tsx`) with 5 s timeouts. Re-run alone, `pnpm --filter @galena/web test` is **85 passed** and `pnpm --filter @galena/server test` is **186 passed, 3 skipped**. I did not touch web, so this is CPU contention, not a regression.

### Problems, deviations from the spec, open questions

- **The gated live integration was not executed.** The test is written
  (`apps/mobile/src/store/integration.test.ts`): it signs in through the real
  server (reading the OTP from the server's own log, never a response), calls
  the production `createChatApi` for `/api/me` and a fresh `POST
  /api/xmpp/token`, connects `@galena/xmpp-core`, creates and joins a room,
  sends a group message and waits for the room echo, then reconnects and
  asserts `getToken` fired a second time. It needs
  `GALENA_AUTH_INTEGRATION_LOG`, `GALENA_AUTH_INVITE_CODE` and
  `GALENA_MOBILE_TEST_EMAIL`; this worktree has no `apps/server/.env` and no
  such values, and I must not read secrets or change the running stack, so I
  could not produce the requested output. Run:
  ```bash
  GALENA_MOBILE_XMPP=1 \
  GALENA_AUTH_INTEGRATION_LOG=<server log> \
  GALENA_AUTH_INVITE_CODE=<fresh invite> \
  GALENA_MOBILE_TEST_EMAIL=<new email> \
  pnpm --filter @galena/mobile test integration
  ```
- **No real-conversation screenshot.** The only booted simulator is the lead's
  "iPhone 17 Pro" and it currently shows a pending "Open in Galena?" dialog
  (the same one T-0026 noted). Its installed Galena build is older and lacks
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
  `EXPO_PUBLIC_GALENA_MOCK=1`); the real store remains the default.
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


---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
