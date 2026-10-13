---
id: T-1297
title: "Web: each chat remembers its scroll position for the session (WUX-28); select mode offers Delete and Copy next to Forward (WUX-32)"
status: merged
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

### Recheck on main
Both findings were still open: WUX-28 (no per-chat scroll memory anywhere in
`MessageList.tsx`/`ChatView.tsx`) and WUX-32 (`SelectionBar.tsx` had only Cancel
and Forward). Neither was fixed, so both were implemented.

### What I did
- **WUX-28.** New `apps/web/src/components/useScrollMemory.ts` keeps a
  session-only `Map<chatId, { messageId, offset }>` (no storage). `MessageList`
  saves the message crossing the top of the view (its id plus its pixel offset
  from the viewport top) on scroll, throttled with `requestAnimationFrame`, and
  writes the final position on unmount so a chat switch remembers it. On opening
  a chat it restores that anchor once the rows are drawn. Restore is skipped
  when the chat opened with unread (divider behaviour kept) or when a jump is
  already pending (search/pin/quote); when the anchor message is not in the
  drawn window it falls back to today's divider/bottom behaviour. The restore is
  applied in the existing layout effect, before the bottom snaps, and clears
  `atBottom`/`atBottomRef` so the ResizeObserver does not pull it back down.
  `MessageList.tsx` stays at 400 lines (`wc -l`).
- **WUX-32.** `SelectionBar` now shows Delete and Copy next to Forward. Delete
  mirrors `MessageMenu`'s rules through `canDeleteMessage` plus the DM
  "delete for me" condition: my own messages delete for everyone, a DM peer's
  message for me; the button is hidden when none of the selected messages can be
  deleted. Confirm dialogs reuse `ConfirmDialog` with the same wording as one
  message (pluralised for 2+). Copy joins the selected texts in list order as
  `Name: text` lines and shows the existing `Copied` toast; it is disabled when
  no selected message has text. `ChatView` passes `chat` and `selectedIds`;
  `SelectionBar` reads the selected messages from the store in `messagesByChat`
  order.
- No tests (UI), as the spec says.

### Files changed
- `apps/web/src/components/useScrollMemory.ts` (new)
- `apps/web/src/components/MessageList.tsx`
- `apps/web/src/components/SelectionBar.tsx`
- `apps/web/src/routes/ChatView.tsx`
- `work/T-1297-web-scroll-select.md`

### Deviations / decisions
- WUX-32 dialog choice: when a DM selection holds a peer's message, only
  "Delete for me" is offered (a peer's message cannot be deleted for everyone);
  when every deletable message in a DM is mine, the same two-option dialog as
  one message is shown ("Delete for everyone" / "Delete for me"). In a group the
  single "Delete" (for everyone) dialog is shown. After deleting, select mode
  exits. `MessageMenu.tsx` was not refactored, so its album title stays
  "Delete album?"; the SelectionBar wording is pluralised instead ("Delete
  messages?").
- Restore does not grow the window to reach an anchor outside it, per the spec's
  "inside the window". `useMessageWindow.ts` needed no change.

### Commands run
- `pnpm install`: done (resolved 1271, added 1181).
- `pnpm gate` (from the repo root): **GATE PASS**. Summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- The first gate run failed lint (`react-hooks(exhaustive-deps)` in
  `useScrollMemory.ts`); I added `scrollRef` to the effect deps and the second
  run was green.
- No single test files were run: the change is UI-only and the gate reports
  `SKIP tests @zilar/web (no nearby test files)`.

### Fix round 1

**1. Scroll memory did not restore (cause).** The anchor was saved and
`restore()` did return `true`, but the position still ended at the bottom.
`MessageList`'s WIP-11 layout effect runs after a restore and falls through to
its own bottom snap (`if (atBottom) scrollTop = scrollHeight`). In dev the app
runs in React StrictMode, which sets up, tears down and sets up effects twice on
mount; the second setup calls `restore()` again, which is a one-shot no-op and
returns `false`, so the effect proceeded to the bottom snap and overrode the
restored position. Reproduced live with `VITE_MOCK=1` and confirmed by
instrumenting `useScrollMemory`: `restore … true` was followed by a scroll
event that saved the bottom. Fixes:
- the layout effect now skips the bottom snap while `restoredScroll.current` is
  true, so the StrictMode second pass cannot undo the restore;
- `atBottomRef` is written directly in `handleScroll`/`scrollToBottom` (and by
  the restore) instead of a separate `useEffect(() => { atBottomRef.current =
  atBottom })`, which could run with the stale `true` and let the
  `ResizeObserver` pin the list to the bottom right after a restore;
- reaching the bottom again clears `restoredScroll`, so later bottom-sticking
  and new-message badge behaviour resume normally.

**2. `MessageList.tsx` line count.** Moved the initial-scroll effect (divider
centring) out into `useInitialScroll` in `useScrollMemory.ts`; the file is back
to **392 lines** (`wc -l`).

**3. Select mode check (mock).** On `VITE_MOCK=1`, in Dev team › General:
- Copy with two of my messages checked produced `You: Dev-1, can you draft a
  fix and a test?` then `You: Ship it behind a flag if it's risky.` — the
  "Name: text" lines in order, with the `Copied` toast.
- Delete on the same two showed "Delete messages? / This deletes them for
  everyone in the chat." and both rows became "You deleted this message".
- Selecting only a peer's message in a group hides Delete (Copy and Forward
  remain), matching "hidden when none of them can be deleted".

**Scroll re-check (mock).** A fresh open lands at the bottom; scrolling Dev team
to 500, switching to QA squad and back restored exactly 500 (the top message and
its offset matched), and a never-visited chat still opens at the bottom. The
`VITE_MOCK=1` dev server started for this check was stopped afterwards.

### Commands run (fix round 1)
- `pnpm --filter @zilar/web exec tsc --noEmit -p tsconfig.json`: 0 errors.
- `pnpm gate`: **GATE PASS**:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  effect
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Commits on the branch: `ab4b1e1dc` (scroll fix) and `13e813cd7` (line count).

## Review (written by Claude)

**Lead, 2026-10-13: approved after fix round 1. Pre-review clean (2 nits).**
- **Lead's check on the web mock:** I scrolled Dev team › General up (scrollTop 1759), opened QA squad, then came back: the chat reopens at 1823 of 2324, near where I left it, no longer at the bottom.
- **Lead's checks after the rebase:** web tsc: 0 errors. `MessageList.tsx` is 392 lines.
