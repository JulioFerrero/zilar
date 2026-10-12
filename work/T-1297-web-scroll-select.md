---
id: T-1297
title: "Web: each chat remembers its scroll position for the session (WUX-28); select mode offers Delete and Copy next to Forward (WUX-32)"
status: todo
milestone: M5
branch: task/T-1297-web-scroll-select
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1297: Scroll memory and select-mode Delete/Copy (web)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md`:
- **WUX-28** (P3, `:89`): the scroll position isn't remembered per chat. Every open remounts and lands at the divider or the bottom, where Telegram restores where you were.
- **WUX-32** (P3, `:99`): select mode only forwards (`apps/web/src/components/SelectionBar.tsx`), with no multi-delete or copy.

The web list now renders a 150-item window (T-1278, `apps/web/src/components/useMessageWindow.ts`).

**First recheck both findings on main.** If one is already fixed, say so with `file:line` and skip it.

### What to build
1. **WUX-28:**
   - keep a session-only map of chat id to scroll position: the id of the message at the top of the view plus its offset, in memory only (no storage);
   - on reopening a chat, restore to that message if it's still loaded and inside the window; otherwise fall back to today's behaviour (the divider or the bottom);
   - a chat with new unread messages keeps today's divider behaviour.
   - Keep `MessageList.tsx` at most 400 lines: put the logic in a new `apps/web/src/components/useScrollMemory.ts`.
2. **WUX-32:** `SelectionBar` gets Delete and Copy.
   - **Delete** uses the same rules and confirm dialogs as one message (delete for everyone on my own messages, delete for me in DMs; `apps/web/src/components/message/MessageMenu.tsx`), applied to every selected message, and is hidden when none of them can be deleted;
   - **Copy** copies the selected texts in order, as "Name: text" lines, and shows the existing toast if one exists.
3. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (`:89`, `:99`), `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/useMessageWindow.ts`, `apps/web/src/components/SelectionBar.tsx`, `apps/web/src/routes/ChatView.tsx` and `apps/web/src/components/message/MessageMenu.tsx`.

### Allowed files
`apps/web/src/components/MessageList.tsx`, `apps/web/src/components/useScrollMemory.ts`, `apps/web/src/components/useMessageWindow.ts`, `apps/web/src/components/SelectionBar.tsx`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/components/message/*.tsx`, `work/T-1297-web-scroll-select.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the web mock:**
  - scroll up in a chat, open another, come back: the same place;
  - select 2 of my messages, Delete removes both;
  - Copy copies them.

---

## Report (written by the worker when done)

## Review (written by Claude)
