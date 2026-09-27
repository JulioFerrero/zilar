---
id: T-0024
title: Web — real login (invite, email code, name) and real chats (xmpp-core + server APIs)
status: todo
milestone: M1
branch: task/T-0024-web-real-data
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0020, T-0021, T-0022]
estimate: 2–3 days
---

# T-0024: Web app on real data

## Spec (written by Claude, do not edit)

### Goal
Turn the web app from mock data into **the real thing**:
- a friend opens an invite link, enters their email and the 6-digit code, types their name, and lands in Galena, already connected to whoever invited them
- they see their real chats and DM or chat in groups in real time, with history, typing, read ticks and online status
- they can create a group from their contacts and invite more friends

This is the milestone where **Julio can actually use Galena**. Keep the Telegram look from `docs/design/ui-style.md`.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md`
- `docs/PROJECT_PLAN.md` §7.2 (the sign-up flow)
- The Reports and Reviews of T-0015, T-0017, T-0020, T-0016, T-0021 and T-0022
- `apps/web/src/**` (the `ChatStore` interface, components, mock store)
- `packages/xmpp-core/src/**`, `packages/chat-core/src/**`
- Better Auth client docs: the React client, the `emailOTP` client plugin, and custom headers through `fetchOptions`

### Allowed files
- `apps/web/**`
- `packages/chat-core/**` (shared logic only)
- `packages/xmpp-core/**`, **only** to add contact (roster) presence events if missing: `on('presence', { jid, available })` for DM contacts. Keep the API additive and tested.
- `pnpm-lock.yaml`

### Decisions
- **API access in development:** the Vite dev server **proxies `/api` to the server** (`http://localhost:3000`), so the browser talks same-origin and cookies just work. The XMPP WebSocket connects directly to the `service` URL returned by `POST /api/xmpp/token`.
- **Auth client:** Better Auth's client with the `emailOTP` plugin. On sign-up through an invite, send the invite code as the `x-galena-invite` header on **both** the send-code and the sign-in requests.
- **Routes:**
  - `/invite/:code`: welcome ("You're invited to Galena"), then the email field, then the code screen
  - `/login`: email, then code, for existing users
  - after a first sign-in, `/welcome/name`, which calls `PATCH /api/me`
  - `/` and `/c/:chatJid`: the app (URL-encode JIDs in routes)
  - **route guard:** no session → `/login`, preserving the target
- **The code screen:** 6 separate digit boxes that auto-advance and accept pasting the whole code, a "Resend code" link after 30 s, and the errors "Wrong code" and "Too many attempts, try again later". It matches the Telegram look (centered card, large title).
- **The real `ChatStore`** implements the **same interface** as the mock store, so components barely change:
  - On load: `GET /api/chats` and `GET /api/me`. Then connect `xmpp-core`, with `getToken` calling `POST /api/xmpp/token`, and join every group room.
  - For each chat, load the **last message** with `loadHistory(chatJid, kind, { max: 1 })`, for the list preview and sorting. Sort by last-message time, newest first.
  - Opening a chat loads 50 messages of history and paginates older ones on scroll-up (`before`).
  - Live messages, typing, displayed markers (✓✓ when the other side displayed them) and occupants (group online counts) come from xmpp-core events.
  - Contact presence gives the DM online dot and the "online" subtitle.
  - **Unread counts:**
    - Keep the last-read message id per chat locally (localStorage, per user id), with a safe `try/catch`.
    - Send `markDisplayed` when a chat is open, visible, and a new message arrives.
    - Count messages after the last-read id among the loaded messages; the MVP accepts that it's approximate.
  - Connection status: a thin bar "Connecting…" / "Waiting for network…" in the list header while not `online`, like Telegram.
- **Groups:** the new-chat menu's **"New group"** opens a two-step dialog: pick contacts (checkboxes), then set the title, then `POST /api/groups`. The new room opens.
- **Invite a friend:** in the menu and the empty state. `POST /api/invites` → a dialog with the link and a **Copy** button.
- **Sign out:** in the ☰ menu. It calls Better Auth's sign-out, disconnects XMPP and clears local state.
- **Keep the mock store** for tests and a `?mock=1` dev mode. It must not ship as the default.

### Tests
- **Store**, with a fake `fetch` and a fake `XmppCore`:
  - loading chats and last messages, sorting
  - a live message updates the preview and unread count
  - opening a chat clears unread and sends `markDisplayed`
  - sending adds the message optimistically, then confirms it
  - pagination
  - status changes show the connecting bar
  - the token is fetched again on reconnect
- **Auth screens:**
  - the invite flow sends the header on both calls
  - the digit boxes accept paste and auto-advance
  - a wrong code shows the error
  - the name step calls `PATCH /api/me`
  - the guard redirects to `/login`
- **New group dialog:** it creates the group and opens it. Invite dialog: it shows the link and copy works.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass.
- [ ] With the dev stack and server running, the full flow works in a browser: invite link → code → name → chat with the inviter. Claude will verify it with two simulator browsers and take screenshots.
- [ ] No token or code is logged. No secrets in the repo.
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
- AIs (M2), push notifications, voice recording, file uploads, message edit and delete, avatars upload.
- Mobile wiring (a separate task).

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

---

## Review (written by Claude)

**Verdict:**

### Findings
-
