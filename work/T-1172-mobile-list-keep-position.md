---
id: T-1172
title: "MUX-1 + MUX-7: the mobile message list keeps the reading position — loading an older page or a new message no longer yanks to the bottom unless you are at the bottom (or the message is yours), and opening the keyboard keeps the last messages visible"
status: merged
milestone: M5
branch: task/T-1172-mobile-list-keep-position
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1172: The mobile list keeps its place

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-1 and MUX-7 (P1, confirmed by code).
- **MUX-1, you can't read older messages:**
  - `apps/mobile/src/components/chat/use-message-list-scroll.ts:62-69` calls `scrollToEnd` whenever `visibleCount` grows, and ignores `atBottomRef` (`:41`);
  - `apps/mobile/src/components/chat/message-list.tsx:247-250` calls `loadOlder` near the top, which prepends a page. The count grows, so the user is thrown to the newest message;
  - any incoming message while reading history does the same;
  - the `FlatList` (`message-list.tsx:213-251`) has no `maintainVisibleContentPosition`. React Native is 0.86.3, which supports it on Android.
- **MUX-7, the keyboard hides the last messages:** the list re-pins only in `onContentSizeChange` (`message-list.tsx:236-241`). The keyboard changes the list's layout, not its content.
- **Telegram:** prepending keeps the viewport where it is, and a new message scrolls only when you are at the bottom.

### What to build
1. **`use-message-list-scroll.ts:62-69`:** replace the count check with a check on the **last entry's key**. Scroll to the end only when the last key changed **and** either `atBottomRef.current` is true or the new last message is outgoing (mine).
   - A prepend (older page) leaves the last key unchanged, so it never scrolls.
   - Pass in what the hook needs, the last entry key and whether it is outgoing, from `entries`, and keep the search-jump guard (`jumpTarget === undefined`).
2. **`message-list.tsx`:**
   - add `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}` to the `FlatList`;
   - add `onLayout`, which calls `scrollToEnd({ animated: false })` when `atBottomRef.current` is true (MUX-7).
3. **Don't change** the mount scroll (`:46-60`), the jump scroll or `initialNumToRender`. MUX-2, the inverted list, is a separate task.
4. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-1, MUX-2, MUX-7), `apps/mobile/src/components/chat/use-message-list-scroll.ts`, `apps/mobile/src/components/chat/message-list.tsx` and `apps/mobile/src/components/chat/jump-scroll.ts`.

### Allowed files
`apps/mobile/src/components/chat/use-message-list-scroll.ts`, `apps/mobile/src/components/chat/message-list.tsx`, `work/T-1172-mobile-list-keep-position.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator or phone:**
  - scroll up in a long chat until an older page loads, and the view stays put;
  - a message from the other side while you are scrolled up doesn't move the view;
  - opening the keyboard at the bottom keeps the last message visible.

---

## Report (written by the worker when done)

### What I did
1. `apps/mobile/src/components/chat/use-message-list-scroll.ts`
   - Replaced the `visibleCount` option with `lastEntryKey: string | undefined` and `lastEntryOutgoing: boolean`.
   - The "new message" effect now scrolls only when `jumpTarget === undefined`, the last entry **key** changed, and either `atBottomRef.current` is true or the new last entry is outgoing. A prepend leaves the last key unchanged, so it never scrolls; an incoming message while reading history (not at bottom) no longer moves the view.
   - The search-jump guard (`jumpTarget === undefined`), the mount scroll (`:46-60`), the jump scroll and `initialNumToRender` are untouched.
2. `apps/mobile/src/components/chat/message-list.tsx`
   - Added `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}` to the `FlatList` (anchors the viewport when a page is prepended).
   - Added `onLayout` that calls `scrollToEnd({ animated: false })` while `atBottomRef.current` is true (MUX-7: the keyboard changes the list's layout, not its content, so `onContentSizeChange` never fired).
   - Passed `lastEntryKey: entries.at(-1)?.key` and `lastEntryOutgoing: isOutgoingMessage(entries.at(-1), currentUserId)` to the hook; added the small module-level `isOutgoingMessage` helper.

### Files changed
- `apps/mobile/src/components/chat/use-message-list-scroll.ts`
- `apps/mobile/src/components/chat/message-list.tsx`
- `work/T-1172-mobile-list-keep-position.md` (status only)

### Commands and results
- `pnpm install`: done, 12.2s, no new warnings beyond the pre-existing `@types/react-dom` peer warning in `apps/mobile`.
- `pnpm gate` (repo root), summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.8s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.7s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No single test files were run: the change is UI only and the chat components have no test files (verified: no `*.test.ts*` under `apps/mobile/src/components/chat/`). The spec says no tests for this task.

### Deviations and notes
- None from the spec. The hook's public option changed from `visibleCount` to the two last-entry inputs, as the spec asked ("pass in what the hook needs, the last entry key and whether it is outgoing, from `entries`").
- The device checks (scroll up to load older, incoming message while scrolled up, keyboard keeps the last message visible) are the lead's emulator/phone checks; I could not run them.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean.**
- **Scroll to the end** keys on the last entry's key, and happens only when the user is at the bottom or the new last message is mine, so a prepended older page never scrolls.
- **The list:** `maintainVisibleContentPosition={{ minIndexForVisible: 0 }}`, plus `onLayout`, which re-pins while at the bottom (MUX-7).
- **Unchanged,** as the spec asked: the mount scroll, the jump scroll and `initialNumToRender`.
- **Still to do:** the device check with the next APK (older page, an incoming message while scrolled up, the keyboard).
