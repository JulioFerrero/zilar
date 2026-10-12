---
id: T-1275
title: "Mobile: a long-press on a photo (album tile or single photo) opens the message menu instead of the viewer — the inner photo Pressables get the bubble's openMenu through a small context"
status: merged
milestone: M5
branch: task/T-1275-photo-long-press-menu
model: auto
effort: default
depends_on: [T-1274]
estimate: 0.1 day
---

# T-1275: Long-press on a photo opens the menu

## Spec (written by Claude, do not edit)

### Why
On the emulator (T-1274's check), a long-press on an album tile opened the photo viewer ("3 / 3") instead of the message menu.
- **The bubble:** it opens the menu from its outer `Pressable` (`apps/mobile/src/components/chat/message-bubble.tsx:277-279`, `onLongPress={generating ? undefined : openMenu}` with `delayLongPress={LONG_PRESS_MS}`).
- **The photos:** they are inner `Pressable`s with `onPress` only, so the inner one takes the touch, and React Native fires its `onPress` on release even after a long hold:
  - album tiles: `apps/mobile/src/components/chat/album-grid.tsx:92-95`;
  - single photos: `apps/mobile/src/components/chat/attachment-message.tsx:97-100`.
- **`LONG_PRESS_MS`:** 350, from `apps/mobile/src/components/chat/message-bubble-decor.tsx:16`.

### What to build
1. A new `apps/mobile/src/components/chat/message-menu-context.tsx` with a context holding the bubble's open-menu function, or `undefined`, plus a `useOpenMessageMenu()` hook.
2. **`message-bubble.tsx`** (391 lines): provide `openMenu` (`:210`) around the bubble's content, `undefined` while `generating`, adding at most 4 lines. If it would pass 400, provide it from the smallest wrapper that fits, and say where.
3. **Album tiles and the single photo `Pressable`:** add `onLongPress={openMenu}` and `delayLongPress={LONG_PRESS_MS}` when the hook returns a function. A short tap still opens the viewer.
4. **No tests** (UI). Keep every file at most 400 lines.

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-bubble-decor.tsx`, `apps/mobile/src/components/chat/album-grid.tsx` and `apps/mobile/src/components/chat/attachment-message.tsx`.

### Allowed files
`apps/mobile/src/components/chat/message-menu-context.tsx`, `apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/album-grid.tsx`, `apps/mobile/src/components/chat/attachment-message.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `work/T-1275-photo-long-press-menu.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:** a long-press on an album tile and on a single photo opens the menu, and a tap still opens the viewer.

---

## Report (written by the worker when done)

**What I did**

- Added `apps/mobile/src/components/chat/message-menu-context.tsx` (27 lines): `MessageMenuContext` holding `(() => void) | undefined`, a `MessageMenuProvider` (same shape as `album-members.tsx`), and the `useOpenMessageMenu()` hook.
- `message-bubble.tsx`: imported `MessageMenuProvider` and wrapped `<MessageBubbleContent>` in `<MessageMenuProvider openMenu={generating ? undefined : openMenu}>` (the only branch that can render an attachment). Added 3 lines (1 import + 2 tags; the wrapped body is only re-indented); the file is now 394 lines, under 400.
- `album-grid.tsx`: `AlbumTile` reads `useOpenMessageMenu()` and spreads `{ onLongPress: openMenu, delayLongPress: LONG_PRESS_MS }` onto the tile `Pressable` only when the hook returns a function. A short tap still calls the tile's `onPress` (the viewer); React Native's Pressability does not fire `onPress` after a long press.
- `attachment-message.tsx`: `AttachmentImage` reads the same hook and spreads the long-press props onto its photo `Pressable`s (see the deviation note). `LONG_PRESS_MS` is the existing 350 ms constant from `message-bubble-decor.tsx`.

**Files changed**

- `apps/mobile/src/components/chat/message-menu-context.tsx` (new, 27 lines)
- `apps/mobile/src/components/chat/message-bubble.tsx` (391 → 394)
- `apps/mobile/src/components/chat/album-grid.tsx` (214 → 220)
- `apps/mobile/src/components/chat/attachment-message.tsx` (299 → 306)
- `work/T-1275-photo-long-press-menu.md` (status + this report)

`attachment-body.tsx` is in the Allowed files but needed no change: the provider sits above `MessageBubbleContent`, so both `AlbumGrid`/`AlbumTile` and `AttachmentImage` are already inside it.

**Commands and results**

- `pnpm install` → `Done in 10.3s` (only a pre-existing unmet peer warning, `@types/react-dom` vs `@types/react`).
- `pnpm gate` → summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.2s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- No single test files run: the spec says "No tests (UI)", and the gate's mobile test step reported `no nearby test files`.

**Deviations from the spec**

- The spec names the single-photo `Pressable` at `attachment-message.tsx:97-100`, which is the mock-mode `gradient:` placeholder tile (`demoGradient !== undefined`). I added the long-press props to that one **and** to the real remote-image `Pressable` below it, because a single photo in production renders through the second one; fixing only the mock tile would leave the bug on real photos. Same file, same feature, no extra files.

**Blocked / needs a decision**

- None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (0 nits).**
- **Lead's check on the emulator (mock build of this branch):**
  - a long-press on the top-right album tile, and on the bottom-right tile (the one that opened the viewer before), opens the message menu;
  - a short tap on a tile still opens the viewer at "2 / 3".
- **Not checked:** the single-photo long-press. The mock's demo photo arrives as a file card ("Not loaded: untrusted host"), so there is no photo to press. It goes on Julio's phone list.
- **Lead's checks after the rebase:** mobile tsc: 0 errors. `message-bubble.tsx` is at 394 lines.
