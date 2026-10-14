---
id: T-1353
title: "Web search results: the 'Messages' section label overlaps the first chat-match row's avatar (Marketing AI) — fix the layout in the chat-list search view"
status: merged
milestone: M5
branch: task/T-1353-search-overlap
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1353: Search results overlap

## Spec (written by Claude, do not edit)

### Why
The lead saw this in T-1352's regenerated screenshots (`docs/screenshots/search-desktop.png` and `search-phone.png`, web in mock at desktop and phone widths, query `ti`, setup `searchTickets` in `scripts/shots.ts`).
- **Order in the chat list's search view:** the two contact-request rows (Theo, Nora), then the chat matches (Marketing AI, Dev AI), then "Ana", then message hits grouped by chat.
- **The bug:** the **"Messages" label is drawn on top of the Marketing AI row**. Its text sits over the yellow avatar, and the Dev AI avatar is pushed into the same spot. The chat-match rows and the "Messages" section are stacking on top of each other instead of flowing.

**Code:**
- the label is `apps/web/src/components/MessageSearchResults.tsx:182` (and `:258`, `:268`, `:278` for the loading, empty and error states);
- the section is rendered from `apps/web/src/components/chatList/ChatListBody.tsx` (194 lines);
- a single hit is `apps/web/src/components/MessageSearchResult.tsx` (106).

The contact-request rows at the top (`apps/web/src/components/chatList/RequestRows.tsx`, T-1336) are new since the last screenshots, so check whether they shift the layout (for example, an absolutely positioned row, a fixed height, or a negative margin).

### What to build
1. Find the cause and cite `file:line`.
2. Fix it so the search view flows top to bottom with no overlap: request rows (if they should show while searching; say what you decide and why, as Telegram hides them while searching), then chat matches, then the "Messages" header, then the hits.
3. Check the mobile search view for the same problem (`apps/mobile/src`; find the chat-list search). Fix it there only if it's broken, and say what you found.
4. Every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/components/chatList/ChatListBody.tsx`, `apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/components/chatList/RequestRows.tsx`, `scripts/shots.ts` (the `searchTickets` setup).

### Allowed files
`apps/web/src/components/chatList/ChatListBody.tsx`, `apps/web/src/components/MessageSearchResults.tsx`, `apps/web/src/components/MessageSearchResult.tsx`, `apps/web/src/components/chatList/RequestRows.tsx`, `apps/web/src/components/ChatList.tsx`, `work/T-1353-search-overlap.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's headless web mock check:** type `ti` in the chat search; nothing overlaps, at desktop and phone widths.

---

## Report (written by the worker when done)

**Fixed; gate green.**

### Cause
`apps/web/src/components/TopicKeyboardNav.tsx:48` renders the chat-match rows in
`<div className="flex min-h-0 flex-1 flex-col">`, and `ChatListBody` puts it directly inside the
scrolling list (`apps/web/src/components/chatList/ChatListBody.tsx:63`,
`flex min-h-0 flex-1 flex-col overflow-y-auto`). A `flex-1` item has `flex-basis: 0`, and
`min-h-0` lets it shrink, so when the sibling below (the `MessageSearchResults` block) is taller
than the list the free space goes negative, the topic wrapper collapses to a few pixels
(measured **64 px** at 1440×900 with query `ti`), and its rows overflow the box and paint over
the following `Messages` section. The new request rows (T-1336) added the height that made this
visible, but it is structural: with query `ti` the `Messages` block alone measured **920 px**
against a **753 px** list, so hiding the requests alone would not have fixed it.

### Fix
- `apps/web/src/components/chatList/ChatListBody.tsx`: wrapped `<TopicKeyboardNav>` in a plain
  `div.shrink-0` so its own `flex-1` no longer applies (a block wrapper's child is not a flex
  item), the rows keep their natural height, and the whole list scrolls. Added an explanatory
  comment.
- Also hid `ContactRequestsRow` while a query is active (`search.trim() === ''`), matching
  Telegram and the mobile app (the phone search view renders `ChatSearchResults`, not the list,
  so it never shows the rows). The search view is now: chat matches → `Messages` header → hits.
- `MessageSearchResults.tsx`, `MessageSearchResult.tsx`, `RequestRows.tsx`, `ChatList.tsx`: no
  change needed.

### Mobile
Not broken, no change. `apps/mobile/src/components/chat/chat-search-results.tsx:106-121` renders
the chat matches in a plain auto-height `View`, then `MessageSearchList` as the final
`ScrollView flex-1` child (`message-search-list.tsx:177`). Nothing there is a zero-basis `flex-1`
sitting next to overflowing content, so it flows.

### Verification
Reproduced and verified with a throwaway headless Playwright run against the dev server in
`?mock=1` mode (the path `scripts/screenshots.ts` uses), desktop 1440×900 and phone 390×844,
query `ti`:
- before: the `Messages` label painted over the Marketing AI row (nav child boxes: request rows
  128 px, topic wrapper 64 px, Messages 920 px — overlap);
- after: chat match (Marketing AI) → `Messages` → group headers/hits, no overlap at either width;
- default (no query) list at both widths: unchanged, request rows still show.

### Commands
`pnpm gate` from the repo root:
```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (3.4s)
PASS  effect  (0.7s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```
No single test files ran: the only changed package is `@zilar/web` and the gate reports no nearby
test files (UI change, no tests per the spec).

### Problems / deviations
None. Hiding request rows during search is the decision the spec left open. `TopicKeyboardNav.tsx`
is the source of the zero-basis `flex-1` but lies outside this task's Allowed files, hence the
wrapper in `ChatListBody.tsx`.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean (0 nits, 1 follow-up); the packet is current for `ee59ba1b`.**
- **Lead's headless web mock check, query `ti` at 1280 and 390 px:** Marketing AI, then the "Messages" header, then hits grouped by chat, with no overlap.
- **Requests while searching:** the request rows hide during a search (Telegram and mobile do the same).
