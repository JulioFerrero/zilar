---
id: T-1301
title: "WUX-34: on narrow web layouts, 'Search in chat' opens a search bar inside the chat (results jump within it) instead of navigating to the chat list"
status: todo
milestone: M5
branch: task/T-1301-web-inchat-search
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1301: In-chat search bar on narrow web

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md` WUX-34 (P3, `:111`): on a narrow screen, "Search in chat" navigates to `/` and focuses the list's search box, leaving the chat. Telegram opens a search bar inside the chat.
- **The header:** `apps/web/src/components/ChatHeader.tsx` (367 lines), with "Search in chat" at `:193` calling `startChatSearch`.
- **The wide layout:** search in chat already works through the list's search box with a chat scope. Find that scope and the message-search results (`apps/web/src/components/MessageSearchResults.tsx`), and reuse them.

**First recheck on main.** If it's already fixed, say so with `file:line` and stop.

### What to build
1. On narrow screens, "Search in chat" shows a search bar in place of the chat header: a back arrow, an input and a result count, with ↑/↓ to step.
2. It runs the same chat-scoped message search the wide layout uses (cite it), and each step jumps to the hit with the existing jump-to-message path (cite it).
3. Esc or the back arrow closes the bar and stays in the chat.
4. Put the bar in a new `apps/web/src/components/ChatSearchBar.tsx`; `ChatHeader.tsx` stays at most 400 lines.
5. The wide layout is unchanged.
6. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (`:111`), `apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/MessageSearchResults.tsx` and the jump-to-message path (find it).

### Allowed files
`apps/web/src/components/ChatHeader.tsx`, `apps/web/src/components/ChatSearchBar.tsx`, `apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/lib/*.ts`, `work/T-1301-web-inchat-search.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock at about 400 px wide:** Search in chat opens the bar, typing finds a message, ↓ jumps to it, and Esc closes the bar and stays in the chat.

---

## Report (written by the worker when done)

## Review (written by Claude)
