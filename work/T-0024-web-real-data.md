---
id: T-0024
title: Web — real login (invite, email code, name) and real chats (xmpp-core + server APIs)
status: merged
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

**`@galena/xmpp-core` — additive contact presence (the only package change).**

- New `PresenceEvent { jid, available }` type, exported from the package index, plus an `on('presence', cb)` overload on `XmppCore`.
- `parseContactPresence(stanza, domain)` in `src/stanza.ts`: accepts a bare-JID presence from our own domain (available = no `type`, unavailable = `type="unavailable"`), ignores MUC presence, other domains, subscription stanzas and sender-less presence.
- `handlePresence` in `src/client.ts` now emits the contact event after the MUC branch (a MUC stanza on `rooms.<domain>` never matches the contact parser). The API is additive; no existing behaviour changed.
- Tests: 3 new cases in `src/presence.test.ts` and a client-level test in `src/core.test.ts` (98 passed, 2 integration skipped).

**`apps/web` — real data.**

- **Dev proxy:** `vite.config.ts` proxies `/api` to `http://localhost:3000` (overridable with `GALENA_API_URL`), so Better Auth cookies are first-party.
- **API client** (`src/lib/api.ts`): zod-validated `fetch` wrappers for `GET /api/me`, `PATCH /api/me`, `GET /api/chats`, `GET /api/contacts`, `POST /api/groups`, `POST /api/invites`, `GET /api/invites/:code`, `POST /api/xmpp/token`, with an `ApiError`.
- **Auth client** (`src/lib/auth.ts`): Better Auth React client with the `emailOTP` plugin; `sendSignInCode`/`verifySignInCode` attach the `x-galena-invite` header when an invite code is present.
- **Session + guards** (`src/auth/AuthProvider.tsx`, `src/routes/AppRoutes.tsx`): `useSession`-based provider; `/invite/:code`, `/login`, `/welcome/name`, `/`, `/c/:chatJid`; a guard redirects guests to `/login` with the target in router state, and users with an empty name to `/welcome/name`. JIDs are URL-encoded in links and decoded in `ChatShell`.
- **Auth screens:** `InvitePage` validates the link with `GET /api/invites/:code`; the shared `AuthFlow` does email → 6-box code (`OtpInput`: auto-advance, backspace, paste, `Wrong code` / `Too many attempts, try again later`) → session; `NamePage` calls `PATCH /api/me`.
- **Real store** (`src/store/realStore.ts`) implementing the extended `ChatStore` interface: loads `/api/me`, `/api/chats`, `/api/contacts`; connects `xmpp-core` with `getToken` calling `POST /api/xmpp/token` (first token reused, fresh token per reconnect); joins every group room; loads each chat's last message with `loadHistory(..., {max:1})` and sorts chats by recency; opening a chat loads 50 messages and paginates on scroll-up (`before`); live messages, typing, displayed markers and occupants come from xmpp-core events; contact presence drives the DM online dot; unread is counted from loaded messages with a per-user `localStorage` last-read map (safe `try/catch`) and `markDisplayed` is sent for visible open chats; a thin "Connecting…" / "Waiting for network…" bar shows while not `online`; `createGroup` creates the group then refreshes `/api/chats` and opens the room; `createInvite` returns the link; `signOut` stops XMPP, clears local state and reloads to `/login`. A generation counter makes `start`/`stop` safe under React StrictMode's double-invoked effects.
- **UI:** `ChatList` got the ☰ menu (Invite a friend / Sign out) and the connection bar, plus the empty-state invite button; `NewChatButton` opens the real `NewGroupDialog` (contacts → title → create → opens) and `InviteDialog` (link + Copy); `Composer` sends typing notifications; `MessageList` paginates older messages on scroll-up.
- **Mock kept:** `?mock=1` (or `VITE_MOCK=1`; tests use `import.meta.env.MODE === 'test'`) still selects the mock store; the real store is the default. The mock implements the extended interface so components are unchanged.
- **Tests** (`apps/web`, 62 passing): `realStore.test.ts` (10: loading/sorting, live message, open clears + `markDisplayed`, optimistic send + echo dedupe, pagination, status, token refetch, group creation, presence, invite), `AuthFlow.test.tsx` (4: invite header on both calls, login without header, wrong code, too many attempts), `OtpInput.test.tsx` (3: paste, auto-advance, invalid), `NamePage.test.tsx` (2: `PATCH /api/me` + refetch, empty name), `NewChatButton.test.tsx` (2: create group and open it, invite link + copy), `App.test.tsx` (3: guest redirect, chat shell, empty-name redirect), plus two connection-bar cases in `ChatList.test.tsx`.

### Files changed

- **New:** `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/components/auth/AuthFlow.tsx`, `apps/web/src/components/auth/OtpInput.tsx`, `apps/web/src/components/InviteDialog.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/routes/InvitePage.tsx`, `apps/web/src/routes/LoginPage.tsx`, `apps/web/src/routes/NamePage.tsx`, `apps/web/src/store/realStore.ts` and their tests.
- **Modified:** `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/App.tsx`, `App.test.tsx`, `src/routes/AppRoutes.tsx`, `src/routes/ChatShell.tsx`, `src/store/store.ts`, `src/store/ChatStoreProvider.tsx`, `src/components/ChatList.tsx`, `ChatListItem.tsx`, `Composer.tsx`, `MessageList.tsx`, `NewChatButton.tsx`, `src/test/renderApp.tsx`.
- **Modified (xmpp-core):** `src/types.ts`, `src/index.ts`, `src/stanza.ts`, `src/client.ts`, `src/core.test.ts`, `src/presence.test.ts`.
- **Modified:** `pnpm-lock.yaml`; `work/T-0024-web-real-data.md` (status + this Report).
- No other task, board or doc file was touched.

### Commands run and real results

- `pnpm install`: PASS — "Done" (added `better-auth`, `zod`, `@galena/xmpp-core` to `apps/web`; lockfile updated).
- `pnpm format:check`: PASS — "All matched files use Prettier code style!" (after `pnpm format`).
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors" (231 files, 127 rules).
- `pnpm typecheck`: PASS — 8/8 tasks successful.
- `pnpm test`: PASS — 8/8 tasks successful. `@galena/web` **62 passed** (17 files); `@galena/xmpp-core` **98 passed, 2 skipped** (the two live-integration files). Other packages unchanged.
- `pnpm build`: PASS — 2/2 tasks successful (web `dist/assets/index-*.js` 563.10 kB).
- No live dev-stack run by me (see below).

### Problems, deviations from the spec, open questions

- **New dependencies (please confirm):** `better-auth` (the spec's Decisions require Better Auth's client), `zod` (AGENTS.md requires zod validation at network boundaries), and `@galena/xmpp-core` (the real store uses it). All are workspace-consistent versions; the spec lists `pnpm-lock.yaml` as allowed.
- **No end-to-end browser run.** Docker/dev-stack and the two simulator browsers are Claude's live check. Everything here is covered by unit tests with a fake `fetch`/XmppCore; the real ejabberd round trip is **not** exercised. The `vite build` warns that `@xmpp/resolve` imports `node:dns`, which Vite externalizes for the browser — the service URL is passed explicitly, so it should be inert, but this is the highest-risk untested area.
- **Unread counts are approximate**, as the spec accepts: they count loaded messages after the stored last-read id, and a live message increments by one. On first load a chat's last message is treated as read (no server-side unread exists).
- **Groups are all in the `personal` space** (no workspace concept yet), so the `Work` folder stays empty.
- **"New message" is not a way to create a DM.** DM chats come from contacts created by invites; the menu item shows an "Invite a friend" prompt instead of a user picker.
- **Sign out reloads** (`window.location.assign('/login')`) so the next user gets a fresh store and XMPP connection; a pure SPA sign-out would leave a torn-down store.
- **`reconnecting` shows "Connecting…"**, and `offline` shows "Waiting for network…" (the spec names both).
- **Reply `senderName`** for a server echo is resolved from the quoted message when it is loaded; otherwise it is empty.
- **`console.log` in `ApprovalCard`** is pre-existing (approve/deny ids, not tokens) and was left untouched.

### Blocked / needs a decision

- Nothing blocked. Please confirm the three dependency additions and run the live flow.

---

## Review (written by Claude)

**Verdict: approved.** Merged by Claude. **Julio used it live.**

### What I verified myself (on commit 05cbede)
- `format:check`, `lint`, `typecheck`, `test` (web **62**, xmpp-core **98**) and `build`: all PASS.
- **Live on the dev stack** (Postgres, ejabberd, server on :3188, Vite on :5173 proxying `/api`):
  - **API level:** a bootstrap invite → A signs up. A's invite → B signs up. Contacts are created automatically in both directions. A creates a group. Both chat lists are correct and tokens are issued.
  - **Chat through `xmpp-core`:** a DM and a group message arrive, with the sender resolved to the real JID. Group history loads and occupants are listed.
  - **In a real browser** (simulator Safari): the invite page validates the code ("You're invited to Galena") and the sign-in page renders.
  - **Julio signed up himself** in his Mac browser through an invite from "Claude (test)", entering the email code and his name, and **sent his first real message**. It arrived, and he received the reply. A group with 3 real accounts works.

### Findings (from real use, fixed in T-0025)
1. **(bug)** The chat-list preview stays on the 🕐 "sending" icon after the bubble shows ✓. The list's `lastMessage` status isn't updated when the message status changes.
2. **(bug)** Being added to a group, or getting a new contact, doesn't update the chat list until you reload. Fix: the server sends XEP-0249 direct invitations when adding group members, and the client reacts to invitations and roster pushes by refreshing `/api/chats`.
3. **(accepted)**
   - the three new dependencies (`better-auth` client, `zod`, `xmpp-core`)
   - approximate unread counts
   - everything in the personal space
   - "New message" pointing to invites
   - sign-out reloads the page
4. **(note)** The `node:dns` externalization warning from `@xmpp/resolve` is harmless in practice: the browser connects with an explicit WebSocket `service` URL. It could be silenced later with a Vite alias.
