---
id: T-1874
title: "Web: Alt+↑ / Alt+↓ open the previous / next chat in the chat list from anywhere (Telegram desktop), using the same a[data-topic-row] rows TopicKeyboardNav moves through; the composer's empty-field ↑ edit ignores Alt"
status: merged
milestone: M5
branch: task/T-1874-web-alt-arrow-chats
model: auto
effort: default
depends_on: []
estimate: 20 min
---

# T-1874: Alt+↑/↓ switches chats (web)

## Spec (written by Claude, do not edit)

### Why
**Julio's easy-life pass (2026-10-17).** Telegram desktop moves to the previous or next chat with Alt+↑/↓ (or Ctrl+Tab, which the browser keeps for itself). Today the web needs a mouse click, or focus on the list plus the arrows (`TopicKeyboardNav`).

### Facts (read by the lead on 2026-10-17)
- **`apps/web/src/components/TopicKeyboardNav.tsx:15-50`:** Up/Down move focus across `nav[aria-label="Chats"] a[data-topic-row]` links, and Enter navigates to the link's `href`.
- **The selected row** has `aria-current="page"`: `apps/web/src/components/ChatListItem.tsx:104` and `apps/web/src/components/TopicRow.tsx:106`.
- **`apps/web/src/routes/ChatShell.tsx`** (79 lines) already has a window `keydown` listener for Escape (`:34-51`), which skips events another handler prevented.
- **`apps/web/src/components/Composer.tsx:262`:** `if (event.key === 'ArrowUp' && editing === undefined && replyTo === undefined)` edits the last message when the field is empty, so Alt+↑ in an empty composer would edit instead of switching.

### Steps
1. **`ChatShell.tsx`:** add a second window `keydown` listener (or extend the existing one; keep it readable).
   - On `event.altKey && !event.ctrlKey && !event.metaKey` with `ArrowUp`/`ArrowDown`, collect `document.querySelectorAll('nav[aria-label="Chats"] a[data-topic-row]')`.
   - Find the index of the one with `aria-current="page"`, and pick the previous or next (no wrap; with no current row, Alt+↓ picks the first).
   - Call `event.preventDefault()` and `navigate(link.getAttribute('href'))`, then `link.scrollIntoView({ block: 'nearest' })`.
2. **`Composer.tsx:262`:** add `!event.altKey` to the condition.
3. **No tests** (UI). Both files stay at most 400 lines.

### Allowed files
- `apps/web/src/routes/ChatShell.tsx`
- `apps/web/src/components/Composer.tsx`
- `apps/web/src/components/TopicKeyboardNav.tsx` (lead fix round)
- `work/T-1874-web-alt-arrow-chats.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Alt+↓ and Alt+↑** open the next and previous row of the chat list (topics included), even while typing in the composer.
- **A plain ↑** in an empty composer still edits the last message.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **`apps/web/src/routes/ChatShell.tsx`:** added a second window `keydown` listener (next to the Escape one) for Alt+↑/↓ (and not with Ctrl or Meta). It collects `nav[aria-label="Chats"] a[data-topic-row]`, finds the row with `aria-current="page"`, and picks the previous/next one with no wrap; with no current row Alt+↓ picks the first, Alt+↑ does nothing. It skips events another handler already prevented, then `preventDefault()`, `navigate(href)` and `scrollIntoView({ block: 'nearest' })`. Works while the composer has focus because it listens on `window`.
- **`apps/web/src/components/Composer.tsx`:** the empty-field ↑ "edit last message" condition now also requires `!event.altKey`, so Alt+↑ reaches the window listener instead of starting an edit. Prettier wrapped the longer condition.
- No tests, as the Spec says (UI). Both files stay under 400 lines (ChatShell 116, Composer 338).

### Checks run
- `pnpm install --frozen-lockfile`: Done in 18.6s.
- `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (0.9s)
  PASS  lint  (1.8s)
  PASS  typecheck  (7.4s)
  PASS  effect  (1.3s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- The first gate run failed only on Prettier for the reformatted condition in `Composer.tsx`; I ran `pnpm exec prettier --write apps/web/src/components/Composer.tsx` (only that condition changed) and the gate above passed. No single test files were run: the Spec asks for none and the gate found no nearby web tests.

### Notes for the lead
- I added an `event.defaultPrevented` skip, matching the existing Escape handler, so a menu or dialog that handles Alt+Arrow itself keeps the key.
- **Fix round (lead pre-review, follow-up 1):** `TopicKeyboardNav`'s `onKeyDown` now returns early on `event.altKey || event.ctrlKey || event.metaKey`, so a focused chat-list row no longer swallows Alt+↑/↓ with its own `preventDefault()`; the ChatShell window listener handles them, plain arrows still move focus as before. `pnpm gate` after the fix: 4 changed files, install/format/lint/typecheck/effect PASS, tests skipped for `@zilar/web` (no nearby test files), scope clean, `GATE PASS`.
- Behaviour is untested in a browser by me (no tests per the Spec); it needs Julio's live check: Alt+↓/↑ from the composer moves through the list including topics, a plain ↑ in an empty composer still edits the last message.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `8d23e1e35`.
- **One lead fix round** made `TopicKeyboardNav` leave Alt/Ctrl/Meta arrows alone. That was the pre-review follow-up: a focused row swallowed Alt+arrows.
- **The mock check** ran on the branch in vite at 1440 px, with Playwright keys:
  - from the composer in "Checkout button hidden on Safari", Alt+↓ goes to Daily standup, Alt+↓ again to Hiring, and Alt+↑ back to Daily standup;
  - with the current chat row focused, Alt+↓ goes to Daily standup.

