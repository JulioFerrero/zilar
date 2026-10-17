---
id: T-1911
title: "Smooth app W3: when chats are on screen, the 'Couldn't load chats / Retrying…' bar (web) and the 'Could not load chats' + swipe-error bars (phone) float as a pill at the bottom of the chat list instead of inserting a row that pushes the chats down"
status: merged
milestone: M5
branch: task/T-1911-list-errors-float
model: auto
effort: default
depends_on: [T-1901]
estimate: 30 min
---

# T-1911: Chat list errors never push the chats

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/smooth-app.md` §4 W3** (Julio, 2026-10-17: things that appear and move all the chats). When a background chat list refresh fails, both apps insert a bar above the chats, then remove it on success, so the list jumps twice. T-1898 already moved "Connecting…" into a floating pill at the top. These bars float at the **bottom** of the list, so the two never overlap.

### Facts (read by the lead on 2026-10-17)
- **Web:**
  - `apps/web/src/components/chatList/ChatListBody.tsx:82-104` (204 lines): when chats exist and `chatsState === 'error' || retrying`, it inserts a `flex … border-b … px-3 py-2` row with the text ("Retrying…" / "Couldn't load chats") and an outline `Retry` button (spinner while retrying);
  - `ChatListBody` sits inside the `relative flex min-h-0 flex-1 flex-col` region of `apps/web/src/components/ChatList.tsx:158`, which also holds the T-1898 pill at `top-2`.
- **Phone:**
  - in `apps/mobile/src/components/chat/chat-list.tsx`, inside the `<View className="flex-1">` from T-1898 (`:102`), two rows are inserted above `FolderPager`:
    - the `swipeError` row (`:112-118`, red 12 px text);
    - `chatsLoad === 'error' && chatsCount > 0 ? <LoadErrorBanner message="Could not load chats. Try again." onRetry={onRetry} />` (`:119-121`);
  - `LoadErrorBanner` (`apps/mobile/src/components/chat/load-error.tsx:54-61`) is a row with `border-b` plus a `RetryButton`. It is used only by `chat-list.tsx`.

### Steps
1. **Web `ChatListBody.tsx`:** the error/retrying row becomes a floating pill. Keep the texts, the Retry button and its disabled/busy/spinner states, and add `role="status"` on the text:
   ```tsx
   <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3">
     <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-surface-raised py-1 pr-1 pl-3 shadow-sm">
       …text… …Retry button…
     </div>
   </div>
   ```
   It stays inside the relative list region, so nothing in the list moves.
2. **Phone `chat-list.tsx`:** move both rows out of the flow into one absolute container at the bottom of the `flex-1` view:
   ```tsx
   <View pointerEvents="box-none" className="absolute bottom-3 left-0 right-0 z-10 items-center gap-2 px-3">
   ```
   - the swipe error as a pill (`rounded-full border border-divider bg-surface-raised px-3 py-1`, red text, `accessibilityLiveRegion="polite"`);
   - the load error as `LoadErrorBanner`.
3. **Phone `load-error.tsx`:** `LoadErrorBanner` becomes the pill: `flex-row items-center gap-2 rounded-full border border-divider bg-surface-raised py-1 pl-3 pr-1`. Drop `flex-1` from the text so the pill hugs its content, and keep `RetryButton`.
4. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/web/src/components/chatList/ChatListBody.tsx`
- `apps/mobile/src/components/chat/chat-list.tsx`
- `apps/mobile/src/components/chat/load-error.tsx`
- `work/T-1911-list-errors-float.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **A failed background refresh with chats on screen** shows a small pill with Retry at the bottom of the list, and the chats never move.
- **The empty-list error state** is unchanged.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **Web** (`apps/web/src/components/chatList/ChatListBody.tsx`): the error/retrying row is now a floating pill at the bottom of the relative list region (`pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-3` wrapper, inner `pointer-events-auto … rounded-full border border-border bg-surface-raised py-1 pr-1 pl-3 shadow-sm`). Texts ("Retrying…" / "Couldn't load chats"), the outline Retry button, its disabled state, `aria-busy` and the spinner are unchanged; the text carries `role="status"`. Since it is absolutely positioned, the chat rows no longer shift when it appears or disappears.
- **Phone** (`apps/mobile/src/components/chat/chat-list.tsx`): the swipe-error row and the `LoadErrorBanner` are now both inside one out-of-flow container (`pointerEvents="box-none" absolute bottom-3 left-0 right-0 z-10 items-center gap-2 px-3`), rendered only when at least one of the two is visible. The swipe error is a small rounded pill (`rounded-full border border-divider bg-surface-raised px-3 py-1`, red 12 px text, `accessibilityLiveRegion="polite"`); the load error uses `LoadErrorBanner`.
- **Phone** (`apps/mobile/src/components/chat/load-error.tsx`): `LoadErrorBanner` is now the pill (`flex-row items-center gap-2 rounded-full border border-divider bg-surface-raised py-1 pr-1 pl-3`), text lost `flex-1` so the pill hugs its content, `border-b`/`justify-between` removed. `RetryButton` kept as is.
- The empty-list error states (web `StateMessage`, mobile `LoadError`) are untouched.

### Checks run
- `pnpm install` → up to date, "Done in 17.3s using pnpm v10.32.1".
- No tests run (the spec says no tests; UI-only change).
- `pnpm gate` from the repo root:
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.7s)
  PASS  format  (1.9s)
  PASS  lint  (3.2s)
  PASS  typecheck  (10.4s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/mobile  (1.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead
- The absolute containers rely on the existing `relative` list regions (`apps/web/src/components/ChatList.tsx:158` and the mobile `flex-1` view), so the pills float and the lists never move. On the web the pill covers the last row visually while shown; the list is scrollable underneath and the button remains clickable (`pointer-events-auto`).
- Deviations from the spec: none. No tests added, as specified.
- Not verified visually on a device/browser by me; the lead's phone smoke and Julio's live check cover the look.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `fb2c80363`.
- **The change:** the web error/retrying bar and the phone swipe-error and load-error bars are pills at the bottom of the list, with Retry kept, so the chats no longer move.
- **The pre-review follow-up** (the web pill "scrolls with the list") **doesn't apply.** The pill's containing block is the `relative` region at `ChatList.tsx:158`, outside the scroller, and the `nav` scroller isn't positioned, so it neither scrolls nor clips the pill.
- **Not triggered on screen:** neither error state can be produced in mock. Checked by reading the code.
