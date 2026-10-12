---
id: T-1191
title: "MUX-8 + MUX-9: mobile chat shows a round jump-to-bottom button (with the count of messages that arrived while scrolled up) once you leave the bottom; dragging the list dismisses the keyboard and the first tap on a bubble or Retry works"
status: merged
milestone: M5
branch: task/T-1191-mobile-jump-and-keyboard
model: auto
effort: default
depends_on: [T-1172, T-1188]
estimate: 0.3 day
---

# T-1191: Jump to bottom and keyboard behaviour on mobile

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-8 and MUX-9 (P2, confirmed by code).
- **MUX-8:** there's no jump-to-bottom button: no `ArrowDown` or `ChevronDown` in `apps/mobile/src/components/chat/`. Telegram shows a round button with the unread count as soon as you scroll up.
  - The scroll hook already tracks `atBottomRef` (`apps/mobile/src/components/chat/use-message-list-scroll.ts:43`, returned at `:123`).
  - Since T-1172, a new message while scrolled up no longer scrolls (`:70-75`).
- **MUX-9:** the `FlatList` in `apps/mobile/src/components/chat/message-list.tsx` sets neither `keyboardDismissMode="interactive"` nor `keyboardShouldPersistTaps="handled"`. Dragging keeps the keyboard up, and the first tap on a bubble or Retry is swallowed. Settings already does this right: `apps/mobile/src/components/settings/screen-shell.tsx:57-59`.
- **Size:** `message-list.tsx` is 329 lines.

### What to build
1. **MUX-9:** add `keyboardDismissMode="interactive"` and `keyboardShouldPersistTaps="handled"` to the message `FlatList`.
2. **MUX-8, a new `apps/mobile/src/components/chat/jump-to-bottom.tsx`** (at most 80 lines): a round button (a lucide `ChevronDown` icon, no emoji) bottom-right above the composer, with a small count badge when the count is above 0.
   - It shows when the user isn't at the bottom. `atBottomRef` is a ref, so expose an `atBottom` **state** that updates only when the boolean flips (not every scroll event) from `use-message-list-scroll.ts`.
   - The count is the number of new last-entry keys that arrived while not at bottom, reset when the user is back at the bottom.
   - A tap calls `listRef.current?.scrollToEnd({ animated: true })`.
   - Mount it from `message-list.tsx`, or from `chat-thread.tsx` if the list ref isn't reachable there; cite which. `message-list.tsx` stays at most 400 lines.
3. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-8, MUX-9), `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/use-message-list-scroll.ts`, `apps/mobile/src/components/chat/chat-thread.tsx` and `apps/mobile/src/components/settings/screen-shell.tsx:50-62`.

### Allowed files
`apps/mobile/src/components/chat/jump-to-bottom.tsx`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/use-message-list-scroll.ts`, `apps/mobile/src/components/chat/chat-thread.tsx`, `work/T-1191-mobile-jump-and-keyboard.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:**
  - scroll up and the button appears; a new message shows a count of 1; a tap goes to the bottom;
  - dragging the list closes the keyboard.

---

## Report (written by the worker when done)

**Status:** done.

**What I did**

- **MUX-9:** added `keyboardDismissMode="interactive"` and `keyboardShouldPersistTaps="handled"` to the message `FlatList` in `message-list.tsx`, matching `settings/screen-shell.tsx:57-59`.
- **MUX-8:** added `apps/mobile/src/components/chat/jump-to-bottom.tsx` (42 lines): a round raised icon key (`IconButton`, `rounded-full`) with a lucide `ChevronDown` (no emoji) and a `CountBadge` at the top-right corner when the count is above 0. It renders nothing when the list is at the bottom.
  - Mounted in **`message-list.tsx`** (not `chat-thread.tsx`): the list ref lives in `useMessageListScroll`, which is called inside `message-list.tsx`, so the ref is not reachable from `chat-thread.tsx`. `message-list.tsx` now wraps the `FlatList` in a `flex-1` `View` so the button can sit absolutely at the bottom-right above the composer.
  - `use-message-list-scroll.ts` now exposes `atBottom` (a state updated only when the boolean flips, via a `setAtBottom` helper that also resets the count when returning to the bottom) and `unseenCount` (incremented when the last-entry key changes while not at bottom and not a search jump; the outgoing case still auto-scrolls instead of counting).
  - The tap calls `listRef.current?.scrollToEnd({ animated: true })`; the button hides and the count clears when the scroll reaches the bottom (driven by the existing `onScroll`).

**Files changed**

- `apps/mobile/src/components/chat/jump-to-bottom.tsx` (new, 42 lines)
- `apps/mobile/src/components/chat/message-list.tsx` (338 lines)
- `apps/mobile/src/components/chat/use-message-list-scroll.ts` (143 lines)
- `work/T-1191-mobile-jump-and-keyboard.md`

`chat-thread.tsx` was left unchanged (the button mounts from `message-list.tsx`, see above). Every touched file is under 400 lines.

**Commands and results**

- `pnpm install`: completed (16 workspace projects, 1180 packages, done).
- Single test files: none run — UI change, and `apps/mobile/src/components/chat/` has no `*.test.*` files. The gate confirmed `SKIP tests @zilar/mobile (no nearby test files)`.
- `pnpm gate` (from the repo root) summary:

```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.7s)
PASS  format  (1.3s)
PASS  lint  (1.2s)
PASS  typecheck  (4.0s)
PASS  effect  (0.8s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Deviations from the spec**

- The spec allows mounting from `chat-thread.tsx` "if the list ref isn't reachable there"; the ref is only reachable in `message-list.tsx`, so the button mounts there, and the spec's "mount it from `message-list.tsx`" option was used.
- When the user is scrolled up and sends their own message, the count is not incremented because the existing scroll behaviour pulls the list to the bottom for outgoing messages. Arriving messages while scrolled up are counted as specified.

**Open questions**

- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean.**
- **MUX-9:** `keyboardDismissMode="interactive"` and `keyboardShouldPersistTaps="handled"` on the message list.
- **MUX-8:**
  - the new `JumpToBottom` (`ChevronDown`, a count badge) shows while `atBottom` is false;
  - `setAtBottom` updates the state only on a flip and resets the unseen count at the bottom;
  - a tap calls `scrollToEnd`.
- **Sizes:** `message-list.tsx` is 338 lines.
- **Still to do:** the emulator check with the next APK.
