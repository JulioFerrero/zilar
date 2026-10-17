---
id: T-1935
title: "Web: in message selection mode, clicking a sticker selects it instead of opening its pack (T-1929 follow-up)"
status: merged
milestone: M5
branch: task/T-1935-web-sticker-select-mode
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1935: A sticker click selects it in selection mode

## Spec (written by Claude, do not edit)

### Why
This is T-1929's pre-review follow-up. Since T-1929 the web sticker image is a `Link` to its pack. In selection mode the row's click toggles selection, but the `Link` also navigates, so the user leaves the chat. The phone is already fine: a full-row overlay `Pressable` catches the tap in selection mode (`apps/mobile/src/components/chat/message-bubble.tsx:324-335`).

### Facts (read by the lead on 2026-10-18)
- **`apps/web/src/components/StickerMessage.tsx`:**
  - props are `{ sticker, message, own }` (`:11-15`);
  - since T-1929 the image or placeholder sits inside `<Link to={\`/stickers/${sticker.pack_id}\`} aria-label="Open sticker pack" className="block cursor-pointer">`.
- **`apps/web/src/components/MessageBubble.tsx`:**
  - `selecting` prop (`:45`, default `false` at `:71`);
  - the row's `onClick` toggles selection while `selecting && !generating && canForward` (`:180-189`);
  - it renders `<StickerMessage sticker={sticker} message={message} own={own} />` (`:232`).

### Steps
1. **`StickerMessage.tsx`:** add an optional prop `selecting?: boolean`. When `selecting` is true, render the image or placeholder without the `Link` wrapper (a plain `div` with the same `block` class), so a click only reaches the row's selection toggle.
2. **`MessageBubble.tsx:232`:** pass `selecting={selecting}`.
3. **No tests** (UI).

### Allowed files
- `apps/web/src/components/StickerMessage.tsx`
- `apps/web/src/components/MessageBubble.tsx`
- `work/T-1935-web-sticker-select-mode.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In selection mode,** clicking a sticker selects or unselects that message and stays in the chat.
- **Outside selection mode,** clicking a sticker still opens its pack.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/components/StickerMessage.tsx`: added an optional `selecting?: boolean` prop (default `false`). The image/placeholder is now built once as `image` and rendered either plain inside a `div className="block"` when `selecting` is true, or inside the existing `Link` to `/stickers/:pack_id` otherwise.
- `apps/web/src/components/MessageBubble.tsx`: passed `selecting={selecting}` to `<StickerMessage>` at the sticker render site.
- No tests, as the spec says (UI-only change).

### Checks run
- `pnpm install`: done (reported "Done in 16.7s using pnpm v10.32.1").
- `pnpm gate` from the repo root:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.1s)
  PASS  format  (0.9s)
  PASS  lint  (1.5s)
  PASS  typecheck  (4.7s)
  PASS  effect  (0.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the change touches only web UI, has no nearby test files, and the spec says no tests.

### Notes for the lead
- Outside selection mode the markup is unchanged, so the sticker still links to its pack.
- In selection mode the wrapper is a plain `div`, so a click bubbles to the row's `onClick` and toggles selection without navigating. This mirrors the mobile overlay `Pressable` approach.
- Manual browser verification of the two acceptance flows was not performed (no UI run in this task); the behaviour follows from the markup change and the row's existing click handler.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `2db796d2c`.
- **The code matches the spec.** In selection mode the sticker is wrapped in a plain `div`, so the click reaches the row's toggle. Outside it, the `Link` to `/stickers/:packId` is unchanged.
- **Not clicked in the browser:** the mock data has no sticker messages. Julio will check on the live web.
