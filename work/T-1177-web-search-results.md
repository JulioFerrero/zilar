---
id: T-1177
title: "WUX-1 + WUX-2: web search — a people row opens the DM (contact) or the @handle card instead of expanding inline; 'No people found' always shows for 3+ chars; Esc clears then blurs; no first-run 'No chats here yet' state under a search with no chat match"
status: merged
milestone: M5
branch: task/T-1177-web-search-results
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1177: Web search behaves like Telegram

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md` WUX-1 and WUX-2 (P1, confirmed).
- **WUX-1:**
  - a people result click toggles `expanded` and renders a bordered `ContactProfileRow` inside the list (`apps/web/src/components/PeopleSearchResult.tsx:88-126`);
  - "No one with that username." shows only when the query starts with `@`; otherwise an empty People section is hidden (`:19-27`);
  - Esc does nothing in `apps/web/src/components/SearchBar.tsx`;
  - the `/@handle` card route is handled at `apps/web/src/routes/AppRoutes.tsx:229,281`.
- **WUX-2:** `apps/web/src/components/chatList/ChatListBody.tsx:109-110` shows `EmptyState variant="no-chats"` (first run, Invite) whenever the **search-filtered** chat list is empty. So "zzz" shows "No chats here yet" under the People and Messages sections.
- **Telegram:** a people row opens the chat or profile and clears the search; Esc clears, then blurs.

### What to build
1. **`PeopleSearchResult.tsx`:**
   - a row for an existing **contact** navigates to `/c/${encodeURIComponent(contact.jid)}`, with the JID from the store's `contacts` by `userId`, as `ContactProfileRow.tsx` does now;
   - any other person navigates to their `/@handle` card;
   - both clear the search text, through the existing search setter: find it, and cite it;
   - remove the inline expanded card;
   - show "No people found" whenever the stripped query has 3 or more characters and there are no people hits, with or without `@`;
   - give each people row `data-topic-row=""` so `TopicKeyboardNav` arrows reach it. Read `TopicKeyboardNav.tsx:1-30` first, and check that Enter on a focused row activates it.
2. **`SearchBar.tsx`:** on Esc, clear the query if it isn't empty; otherwise blur the input.
3. **`ChatListBody.tsx:109-110`:** when the search is non-empty and no chat matches, render one muted line, "No chats match", instead of the first-run `EmptyState`. Keep the first-run state for an empty search.
4. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (WUX-1, WUX-2, WUX-12), `apps/web/src/components/PeopleSearchResult.tsx`, `apps/web/src/components/SearchBar.tsx`, `apps/web/src/components/chatList/ChatListBody.tsx`, `apps/web/src/components/TopicKeyboardNav.tsx`, `apps/web/src/components/ContactProfileRow.tsx:120-160` and `apps/web/src/routes/AppRoutes.tsx:220-300`.

### Allowed files
`apps/web/src/components/PeopleSearchResult.tsx`, `apps/web/src/components/SearchBar.tsx`, `apps/web/src/components/chatList/ChatListBody.tsx`, `work/T-1177-web-search-results.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the live web:**
  - typing a contact's name and clicking the person opens the DM, and the search clears;
  - "zzz" shows "No people found" and "No chats match", with no Invite card;
  - Esc clears, then blurs.

---

## Report (written by the worker when done)

**Status:** done — gate green.

**What I did**

1. `apps/web/src/components/PeopleSearchResult.tsx`:
   - A person row is a react-router `<Link>`: an existing **contact** opens `/c/${encodeURIComponent(contact.jid)}` (JID looked up in the store's `contacts` by `userId`), anyone else opens `/@${entry.handle}`. Both clear the search through the store's existing setter `setSearch` (`apps/web/src/store/effects/chatActions.ts:214`, read with `useChatSelector((s) => s.setSearch)`). A contact whose DM row is not in `chats` yet triggers `refreshChats()` first, the same guard `ContactProfileRow.tsx:136-146` uses.
   - Removed the inline expanded `ContactProfileRow` card and the `expandedId` state.
   - The empty People state now reads "No people found" for any 3+ character query, with or without `@`; the old `hadAt` gate is gone. (`ChatListBody` mounts this component only at `PEOPLE_SEARCH_MIN_LENGTH`, so no length re-check was needed.)
   - Each person row carries `data-topic-row=""`. `TopicKeyboardNav` only walks `a[data-topic-row]`, so the row had to become an anchor: Enter activates it natively (it is a link), and the arrows reach it once focus is in the chat list.

2. `apps/web/src/components/SearchBar.tsx`: on Esc, a non-empty query is cleared (`preventDefault`), otherwise the input blurs.

3. `apps/web/src/components/chatList/ChatListBody.tsx:109-115`: when the search text is non-empty and no chat/archived row matches, one muted "No chats match" line replaces the first-run `EmptyState`; an empty search keeps the Invite/Explore state.

**Files changed**

- `apps/web/src/components/PeopleSearchResult.tsx`
- `apps/web/src/components/SearchBar.tsx`
- `apps/web/src/components/chatList/ChatListBody.tsx`
- `work/T-1177-web-search-results.md` (this file)

**Commands**

- `pnpm install`: Done in 18.7s.
- `pnpm gate` (repo root): **GATE PASS**. Summary lines:
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  effect`
  - `SKIP  tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
- Single test files: none run — none of the three touched files has a test file, and the spec says "No tests (UI)". The gate skipped the web tests for the same reason.

**Deviations from the spec**

- `GroupRow` was left as a `button` + `useNavigate` (only "people rows" needed `data-topic-row`, and the spec asked for that on people rows only). `PersonRow` got the `Link` change because the `TopicKeyboardNav` selector only matches anchors.

**Open questions / limitations**

- Read from the code, not tested live: `PeopleSearchResult` renders outside the `TopicKeyboardNav` wrapper (`ChatListBody.tsx:108` vs `:117`), so pressing Up/Down while a **person row** itself has focus does not move on — the handler lives on the sibling wrapper. Arrows reach a person row from inside the chat list (the `index + 1` wrap), and Enter activates the focused link natively. This is the same shape WUX-12 tracks. Say the word if you want the handler widened in this task.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean.**
- **People rows** open the DM (contact) or the `/@handle` card, and clear the search. The inline card is gone.
- **"No people found"** shows for 3 or more characters, and rows carry `data-topic-row` for the arrow keys.
- **SearchBar:** Esc clears, then blurs.
- **ChatListBody:** a search with no matching chat shows "No chats match" instead of the first-run state.
- **Still to do:** the live check on web.
