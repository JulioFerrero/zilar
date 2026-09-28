---
id: T-0027
title: Mobile — real chats: the phone shows real DMs and groups via xmpp-core, with history, typing, receipts and live updates
status: todo
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
-

### Files changed
-

### Commands run and real results
- `pnpm typecheck`:
- `pnpm lint`:
- `pnpm test`:
- integration run (redacted):

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
- (only if status is blocked)

---

## Review (written by Claude)

**Verdict:**

### Findings
-

### Follow-ups
-
