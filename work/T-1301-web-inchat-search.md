---
id: T-1301
title: "WUX-34: on narrow web layouts, 'Search in chat' opens a search bar inside the chat (results jump within it) instead of navigating to the chat list"
status: merged
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

### First recheck on main
Not already fixed. On `main`, `ChatHeader.startChatSearch` (`apps/web/src/components/ChatHeader.tsx`, old `:57-71`) navigates to `/` and dispatches `zilar:focus-search` on narrow (`navigate('/')` when `!isWide`). Before this task, `ChatHeader.tsx` line 193 was the "Search in chat" button and the topic menu "Search" entry (old `:240-247`) called the same `startChatSearch`.

### What I did
1. New `apps/web/src/components/ChatSearchBar.tsx`: the narrow in-chat search bar that replaces the header. Back arrow (closes), a `type="search"` input autofocused on mount, a match counter, and ↑/↓ (also Enter = next) to step. On results arrival it lands on the newest hit (`items[0]`, like Enter in the wide search box); each ↑/↓ lands on its hit. A failed open shows "Message not found".
2. `apps/web/src/components/ChatHeader.tsx` (376 lines, was 367): `startChatSearch` opens the bar on narrow; the wide path (`setSearchChat(chat.id)` + `zilar:focus-search`) is unchanged. Added `searchOpen` state and an early return of `<ChatSearchBar>` when `searchOpen && !isWide`. Both the header button (`:202`) and the topic menu "Search" entry call it, so both get the bar.
3. `apps/web/src/components/MessageSearchResults.tsx`: exported `useOpenHit` for the bar and fixed its scroll: it now defers `scrollToMessage` to the next frame (`window.requestAnimationFrame`), like `MessageBubble.tsx:150`, `PinnedBanner.tsx:46`, `PinsPanel.tsx:159` and `useShowInChat.ts:19`, and takes a `mode` so the bar can `replace` a jump still paging instead of dropping the next step.
4. `apps/web/src/lib/scrollToMessage.ts`: broadcasts a short accent outline pulse on the target bubble with the Web Animations API (skipped when `animate` is absent, e.g. jsdom), so a jump is visible even when the list cannot scroll because the hit is already on screen.

### Reuse (as the spec asks)
- **Chat-scoped message search:** `useMessageSearch(query, chat.id)` from `apps/web/src/lib/useMessageSearch.ts` — the same hook `MessageSearchResults` (`apps/web/src/components/MessageSearchResults.tsx`) uses with the list's `chatFilter` (fed from `store.searchChat` set by the wide header path).
- **Jump-to-message path:** `useOpenHit` (`apps/web/src/components/MessageSearchResults.tsx:21-43`), which calls `storeApi.getState().openAtMessage(chatJid, messageId)` (this pages the hit in when it is not loaded, via the store's `openAtMessage` wrapper at `apps/web/src/store/effects/history.ts:88-95`), then `navigate('/c/<chatJid>')` and `scrollToMessage(messageId)`; the message window reveal (`apps/web/src/components/useMessageWindow.ts:95-113`) scrolls once a not-yet-drawn row is rendered, and `scrollToMessage` pulses the highlight.
- **Esc stays in chat:** a capture-phase `window` keydown listener in `ChatSearchBar` handles Escape only when the key came from inside the bar and calls `stopPropagation`, so the shell's narrow Esc-to-home listener (`apps/web/src/routes/ChatShell.tsx:30-38`) does not fire. The back arrow just calls `onClose`.

### Fix round 1: why the jump did not fire
Round 1 only stepped on ↓/Enter — it did not jump when results arrived. Worse, its jump reused `useOpenHit`'s old scroll, which ran `scrollToMessage` bare in the same tick as `openAtMessage`'s resolution. Every other in-app jump (`MessageBubble.tsx:150`, `PinnedBanner.tsx:46`, `PinsPanel.tsx:159`, `useShowInChat.ts:19`) defers that scroll to the next frame for exactly this reason. The wide layout usually opens a hit into a chat that is *not* the one on screen, so the message list mounts/pages and the deferred reveal effect (`useMessageWindow.ts:95-113`) performs the scroll; in the bar the chat is already open and pinned to the bottom, so the immediate scroll raced the list's post-jump layout and had no highlight, so it produced no visible movement. This round jumps on arrival, defers the scroll one frame, replaces a pending jump while stepping, and pulses the target so any hit is visibly marked.
I could not reproduce the browser check in this session, so that explanation is read from the code rather than observed; the gate and `tsc` below are the only runs I made.

### Optional spec items
- `ChatView.tsx` was allowed but not needed; the bar is selected inside `ChatHeader`, so `ChatView` is untouched.
- No tests (UI), per the spec.

### Commands and results
- `pnpm --filter @zilar/web exec tsc --noEmit -p tsconfig.json` — 0 errors (no output).
- `pnpm gate` (final) — real summary lines:
  - `gate: 5 changed file(s) against main`
  - `PASS  install (frozen)  (1.1s)`
  - `PASS  format  (1.1s)`
  - `PASS  lint  (0.7s)`
  - `PASS  typecheck  (0.8s)`
  - `PASS  effect  (0.4s)`
  - `SKIP tests @zilar/web (no nearby test files)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`
- No single test files were run: the change is UI and the gate found no nearby tests.

### Files changed
- `apps/web/src/components/ChatSearchBar.tsx` (new)
- `apps/web/src/components/ChatHeader.tsx`
- `apps/web/src/components/MessageSearchResults.tsx`
- `apps/web/src/lib/scrollToMessage.ts`
- `work/T-1301-web-inchat-search.md`

### Deviations, problems, open questions
- No existing message highlight was in the tree (grep for a jump/reveal highlight found none), so "the same highlight the wide layout's jump uses" did not exist yet; I added it in the shared `scrollToMessage` primitive, so the wide jump and the bar's jump now share one highlight.
- No live browser check was run here (no web mock started in this session); the ~400 px acceptance check is left to the lead.
- **Rebase conflict (T-1285/WUX-23):** `MessageSearchResults.tsx` conflicted — main added `EMPTY_ITEMS` and keyboard hit-selection, my side changed `useOpenHit`; I kept both (main's constant and wide selection, my `mode`/deferred-scroll signature), then `pnpm --filter @zilar/web exec tsc --noEmit -p tsconfig.json` (0 errors) and `pnpm gate` (`GATE PASS`, 5 files, all inside the Allowed files).

## Review (written by Claude)

**Lead, 2026-10-13: approved after fix round 1. Pre-review clean (3 nits).**
- **Lead's check on the web mock** (the app in a 400 px iframe, Dev team › General):
  - Search in chat opens the in-chat bar, and "staging" shows "1 of 1";
  - Enter or ↓ scrolls to Luis's "Deployed to staging." and outlines it.
- **Nit:** typing alone doesn't jump until Enter or ↓.
