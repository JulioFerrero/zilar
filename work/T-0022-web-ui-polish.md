---
id: T-0022
title: Web UI polish — new-chat button, unread divider, typing, message menu + reply, big emoji, safe links
status: merged
milestone: M1
branch: task/T-0022-web-ui-polish
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0018]
estimate: 1–2 days
---

# T-0022: Web UI polish

## Spec (written by Claude, do not edit)

### Goal
Make the web app feel even more like a polished messenger. Implement **every item** in `docs/design/ui-style.md` §4, under "Added after the first screenshots (2026-09-27)", in `apps/web`, still with **mock data**. Keep everything behind the `ChatStore` interface so real data can be plugged in later. Julio likes these details, and Claude will screenshot the result.

### Read first
- `AGENTS.md` (mandatory)
- `docs/design/ui-style.md`, **especially the new subsection and the `--online` token**
- `work/T-0018-web-chat-shell.md`: its Report and Review
- `apps/web/src/**` and `packages/chat-core/src/**`

### Allowed files
- `apps/web/**`
- `packages/chat-core/**`, for shared pure logic (e.g. big-emoji detection, URL splitting, the unread-divider position)
- `pnpm-lock.yaml`, only if a dependency is added (none should be needed)

**Not allowed:** `apps/server/**`, `apps/mobile/**`, `packages/xmpp-core/**`, `infra/**`. Other workers are editing those. No Docker.

### What to build
1. **The `--online` token** and a green online dot, per `ui-style.md`.
2. **Mute icon spacing** per the new subsection.
3. **New-chat button:** a round accent pencil button at the bottom right of the chat list column, opening a small menu with "New group" and "New message". Both open a simple placeholder dialog for now: "Coming soon" plus a Close button, keyboard accessible, `Esc` closes. **Don't use `window.alert` or `confirm`.**
4. **Unread divider.** In `chat-core`: `unreadDividerIndex(items, lastReadMessageId | unreadCount)`. On web, render the "Unread messages" bar and scroll it into view when a chat with unread messages opens. Add mock data so "Ana" (unread 2) shows it.
5. **Typing:**
   - The store gets `typing: Record<chatId, { names: string[] }>` and a mock simulation: typing appears in "Ana" 2 s after the app loads and lasts 4 s, and in "Viernes 🍻" as "Luis is typing…".
   - Render it in the list preview and the header subtitle per the spec, with the animated dots.
6. **Message actions menu:**
   - Right-click (and a small ⋯ button on hover) opens a menu with **Reply**, **Copy text** (`navigator.clipboard.writeText` with a fallback) and **Delete** (disabled).
   - Keyboard accessible (the menu is focusable, `Esc` closes). Use the shadcn/radix dropdown or context menu if already installed; otherwise a small custom menu.
7. **Reply:**
   - The composer shows the reply bar (per the spec), and `×` cancels.
   - Sending calls `store.sendText(chatId, text, { replyTo })`, and the new bubble shows the reply quote.
   - `Esc` cancels a reply when the composer is focused.
8. **Big emoji:** `isBigEmoji(text)` in `chat-core`, true for 1–3 emoji graphemes and nothing else (no text, no digits). Use `Intl.Segmenter` for graphemes. Render per the spec.
9. **Safe links:**
   - `splitLinks(text)` in `chat-core` returns text and link segments for **http/https URLs only**, and handles trailing punctuation (`https://x.com/a).` → the link is `https://x.com/a`).
   - Render the links with `target="_blank" rel="noopener noreferrer"`.
   - **`javascript:`, `data:`, `vbscript:` and `file:` never become links.**
10. **Full time tooltip** on bubble times: `title` or a tooltip with the full date and time.

### Tests
- **chat-core:**
  - `isBigEmoji`: 1, 2 and 3 emoji → true; 4 emoji, emoji plus text, digits, flags and ZWJ families → treated as 1 grapheme each
  - `splitLinks`:
    - http, https, trailing punctuation, multiple links
    - `javascript:alert(1)`, `data:text/html,…` and a bare `www.x.com` are **not** links (bare `www` is out of scope, so it isn't linked)
  - `unreadDividerIndex`
- **web (Testing Library):**
  - the pencil menu opens, the dialog opens, and `Esc` closes it
  - Ana's chat shows the divider
  - typing appears in the list and the header with fake timers, then disappears
  - right-click opens the menu; Reply shows the reply bar; `×` cancels; sending with a reply renders a quote
  - Copy calls the clipboard with the message text
  - a big-emoji message renders without the bubble class
  - a link renders as `<a>` with `rel` and `target`, and a `javascript:` string renders as plain text
  - the online dot uses the `--online` color class

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` pass for the whole repo.
- [ ] Every item in the "Added after the first screenshots" subsection that applies to web is implemented (swipe and haptics are mobile only).
- [ ] No `alert` / `confirm` / `prompt`. No unsafe link schemes.
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
- Real data, login and XMPP (wiring comes next).
- Mobile (a separate task).

---

## Report (written by the worker when done)

### What I did
Implemented every web item from `docs/design/ui-style.md` §4 "Added after the first screenshots (2026-09-27)" in `apps/web` on top of the T-0018 shell, keeping all data behind the `ChatStore` interface and all shared pure logic in `packages/chat-core`:

1. **Theme:** added the `--online: #4dcd5e` token (light and dark) and mapped it to Tailwind via `--color-online`; `Avatar`'s online dot now uses `bg-online`.
2. **Mute icon spacing:** the AI badge and mute icon are spaced explicitly (`ml-1.5` for the badge, `ml-4` = 16 px for the mute icon), vertically centered with the name.
3. **New-chat button:** `NewChatButton` — a round 56 px accent pencil button pinned to the bottom right of the chat list column. It opens a small `role="menu"` with **New group** / **New message**; each opens a keyboard-accessible placeholder `role="dialog"` reading "Coming soon" with a **Close** button. Focus moves to Close on open and `Esc` closes it. No `alert`/`confirm`/`prompt`.
4. **Unread divider:** `unreadDividerIndex(items, lastReadMessageId | unreadCount)` in chat-core returns the render-item index above the first unread message. `MessageList` captures the chat's unread count at mount (before `openChat` clears it), renders the full-width `UnreadDivider` ("Unread messages") and calls `scrollIntoView({ block: 'center' })` on it instead of scrolling to the bottom. Ana's mock (unread 2) shows it; reopening the chat remounts the list and the divider is gone.
5. **Typing:** the store gained `typing: Record<chatId, { names: string[] }>` plus a mock simulation (`scheduleTypingSimulation`) that sets Ana (`['Ana']`) and Viernes 🍻 (`['Luis']`) after 2 s and clears after 6 s. `ChatListItem` shows `typing…` (accent) or `Luis is typing…` in place of the preview, and `ChatHeader` shows the same as the subtitle — both with the existing animated dots (`TypingDots`, extracted from the old `WorkingDots`).
6. **Message actions menu:** right-click on a bubble, or the ⋯ button revealed on hover, opens `MessageActionsMenu` with **Reply**, **Copy text** (`copyText`: async Clipboard API with a temporary-textarea fallback) and **Delete** (disabled). The menu is focusable (first item focused on open), closes on `Esc` and on an outside click.
7. **Reply:** `ChatView` owns the draft reply; `ReplyQuote`/message data builds a `ReplyRef`. The composer shows the reply bar (colored left bar, "Reply to {name}" in accent, one-line excerpt, `×` to cancel); `Esc` in the textarea cancels. Sending calls `store.sendText(chatId, text, { replyTo })` and the new bubble renders the quote.
8. **Big emoji:** `isBigEmoji(text)` in chat-core accepts 1–3 emoji graphemes and nothing else (no text, digits or keycaps), counting flags and ZWJ families as one grapheme via `Intl.Segmenter`. Such messages render bubble-less at 48 px with the time in a small translucent pill below.
9. **Safe links:** `splitLinks(text)` in chat-core links only `http://`/`https://` with a non-empty authority, trims trailing sentence punctuation (`https://x.com/a).` → `https://x.com/a`) while keeping balanced brackets; `javascript:`, `data:`, `vbscript:`, `file:` and bare `www.x.com` stay plain text. `LinkText` renders `<a target="_blank" rel="noopener noreferrer">`.
10. **Full time tooltip:** bubble times carry a `title` with `formatFullDateTime` (full date + clock time).

Tests added: chat-core `emoji.test.ts` (6), `links.test.ts` (6), `unreadDividerIndex` cases in `messages.test.ts` (6) and `formatFullDateTime` in `format.test.ts`; web `NewChatButton.test.tsx` (2), `MessageActions.test.tsx` (5), `MessageContent.test.tsx` (4: big emoji, safe link, unsafe scheme, full-time title), `TypingIndicator.test.tsx` (1, fake timers), `UnreadDivider.test.tsx` (1, asserts `scrollIntoView`) and an online-dot case in `Avatar.test.tsx`.

### Files changed
**`packages/chat-core`** (new) `src/text.ts`, `src/emoji.ts`, `src/emoji.test.ts`, `src/links.ts`, `src/links.test.ts`; (modified) `src/avatar.ts` (reuses the shared `graphemes`), `src/format.ts` (+`formatFullDateTime`), `src/format.test.ts`, `src/messages.ts` (+`unreadDividerIndex`), `src/messages.test.ts`, `src/index.ts`.

**`apps/web`** (new) `src/components/TypingDots.tsx`, `src/components/NewChatButton.tsx`, `src/components/MessageActionsMenu.tsx`, `src/components/LinkText.tsx`, `src/components/UnreadDivider.tsx`, `src/lib/clipboard.ts`, and the tests `NewChatButton.test.tsx`, `MessageActions.test.tsx`, `MessageContent.test.tsx`, `TypingIndicator.test.tsx`, `UnreadDivider.test.tsx`; (modified) `src/index.css`, `src/components/Avatar.tsx`, `Avatar.test.tsx`, `ChatHeader.tsx`, `ChatList.tsx`, `ChatListItem.tsx`, `Composer.tsx`, `MessageBubble.tsx`, `MessageList.tsx`, `src/lib/format.ts` (+`typingLabel`, +`replyRef`), `src/routes/ChatView.tsx`, `src/routes/ChatShell.tsx`, `src/store/store.ts`, `src/test/setup.ts` (jsdom `scrollIntoView` stub).

Also `work/T-0022-web-ui-polish.md` (status + this Report). No other files touched; no dependency added.

### Commands run and real results
- `pnpm install`: Done in ~10 s — 902 packages, all 9 workspace projects resolved; lockfile up to date.
- `pnpm format:check`: "All matched files use Prettier code style!".
- `pnpm lint`: "Found 0 warnings and 0 errors" (204 files, 127 rules).
- `pnpm typecheck`: 8 successful, 8 total.
- `pnpm test`: 8 tasks successful. `@zilar/web` **40 passed** (13 files); `@zilar/chat-core` **50 passed** (5 files); `@zilar/mobile` 48 passed (7 files, unchanged); `@zilar/devtools` 9 passed (1 file).
- `pnpm build`: 2 successful (web `dist/assets/index-*.js` 352.30 kB, `index-*.css` 32.07 kB; mobile Expo export).
- Verified in the built CSS: `--online:#4dcd5e` (light + dark), `.bg-online`, `.typing-dot`.

### Problems, deviations from the spec, open questions
- **Visual check not done by me:** `pnpm --filter @zilar/web dev --port 5211` starts cleanly ("VITE v8.3.1 ready"), but the desktop browser tool was disconnected in this session, so I could not screenshot the result. Behaviour is covered by the Testing Library tests and the built CSS above; Claude will screenshot.
- **Message actions menu is custom, not radix.** The spec allows "a small custom menu" when the shadcn dropdown/context menu isn't already installed. The repo has the `radix-ui` primitives but no shadcn `dropdown-menu`/`context-menu` component (only `ui/button.tsx`), and the custom menu covers the required behaviours for both the right-click and the ⋯ trigger (focus on open, `Esc`, outside-click) and is directly testable with the installed tooling (`@testing-library/user-event` isn't installed). Happy to migrate to radix if you prefer.
- **DM typing label** is the bare `typing…` for the list and header (per the spec text), while groups name the first person (`Luis is typing…`).
- **Reply quote source** uses `previewBody` for the excerpt, so replying to a voice/photo message quotes `🎤 Voice message (0:12)` / `🖼 Photo`.
- No new open questions; the task is ready for review.


---

## Review (written by Claude)

**Verdict: approved.** Merged by Claude.

### What I verified myself (on commit 31125e4)
- `format:check`, `lint`, `typecheck`, `test` (web **40**, chat-core **50**) and `build`: all PASS. No `alert` / `confirm` / `prompt` in the app code (`javascript:alert(1)` appears only as a test string for the link filter).
- Screenshots in iPad simulator Safari show:
  - `typing…` with animated dots in the list and the header ("Luis is typing…" in the group)
  - the **Unread messages** divider in Ana's chat
  - the pencil new-chat button
  - **big emoji** without a bubble, with a time pill
  - fixed initials ("V")
  - the green online dot
  - the mute icon spacing
  - reply quotes

### Findings
1. **(nit, next polish)** The sender name above a big-emoji message is faint (pale name with no bubble). Hide it, as most messengers do: show only the avatar.
2. **(accepted)**
   - the custom message menu (focus, `Esc`, outside click)
   - the bare `typing…` in DMs
   - voice and photo reply excerpts through `previewBody`
