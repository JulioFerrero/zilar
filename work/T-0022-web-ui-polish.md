---
id: T-0022
title: Web UI polish — new-chat button, unread divider, typing, message menu + reply, big emoji, safe links
status: todo
milestone: M1
branch: task/T-0022-web-ui-polish
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0018]
estimate: 1–2 days
---

# T-0022: Web UI polish

## Spec (written by Claude, do not edit)

### Goal
Make the web app feel even more like Telegram. Implement **every item** in `docs/design/ui-style.md` §4, under "Added after the first screenshots (2026-09-27)", in `apps/web`, still with **mock data**. Keep everything behind the `ChatStore` interface so real data can be plugged in later. Julio likes these details, and Claude will screenshot the result.

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
