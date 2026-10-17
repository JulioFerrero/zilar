---
id: T-1929
title: "Tapping a sticker in a chat opens its pack page (web + phone), where the existing Add to my stickers key adds it"
status: merged
milestone: M5
branch: task/T-1929-sticker-tap-opens-pack
model: auto
effort: default
depends_on: []
estimate: 25 min
---

# T-1929: Tap a sticker to see its pack

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17:**

> when i send a sticker, if i click the sticker needs to show the sticker pack and the option to import or add to my account

That is how Telegram works. Both apps already have a pack page with Add.

### Facts (read by the lead on 2026-10-17)
- **`packages/protocol/src/sticker.ts:16-`:** every sticker payload carries `pack_id` (a UUID).
- **Phone:**
  - `apps/mobile/src/components/chat/sticker-message.tsx` (104 lines): `StickerMessage` renders `<Pressable onLongPress={onLongPress} delayLongPress={350} accessibilityRole="image" …>` (`:64-`) with no `onPress`;
  - the pack page `apps/mobile/src/app/stickers/[packId].tsx` (280 lines) has the "Add to my stickers" key (`:265-270`).
- **Web:**
  - `apps/web/src/components/StickerMessage.tsx` (71 lines): a `<div className="relative inline-block max-w-[200px]">` holds the `<img>` or the placeholder, plus the time pill. There is no click handler;
  - the pack route is `path="/stickers/:packId"` (`apps/web/src/routes/AppRoutes.tsx:220-223`), and `StickerPackPage` has Add/Remove (`apps/web/src/routes/StickerPackPage.tsx:54-61`).

### Steps
1. **Phone `sticker-message.tsx`:** add `onPress={() => router.push(\`/stickers/${sticker.pack_id}\`)}` (expo-router `useRouter` or `router`, as the app's other links do). Keep `onLongPress` and its delay, so the message menu still opens on a long press. Set `accessibilityHint="Opens the sticker pack"`.
2. **Web `StickerMessage.tsx`:** make the sticker image (or placeholder) a button-like link to `/stickers/${sticker.pack_id}`.
   - Use react-router's `Link`, or `useNavigate` on a `<button type="button">`, whichever the codebase uses for in-app links.
   - Give it `aria-label="Open sticker pack"` and `cursor-pointer`.
   - It must not break the bubble's right-click / long-press menu: keep the existing outer element and only wrap the image.
3. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/sticker-message.tsx`
- `apps/web/src/components/StickerMessage.tsx`
- `work/T-1929-sticker-tap-opens-pack.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Tapping (phone) or clicking (web) a sticker** in any chat opens that sticker's pack page, with "Add to my stickers" (or Remove when you already have it).
- **A long press (phone) or right-click (web)** still opens the message menu.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **Phone** — `apps/mobile/src/components/chat/sticker-message.tsx`: imported the static `router` from `expo-router` (the pattern `mention-text.tsx` and `person-pressable.tsx` use) and added an `onPress` that pushes the template route `/stickers/<pack_id>` plus `accessibilityHint="Opens the sticker pack"` to the existing `Pressable`. `onLongPress` and `delayLongPress={350}` are unchanged, so the menu still opens on a long press.
- **Web** — `apps/web/src/components/StickerMessage.tsx`: imported `Link` from `react-router` (used elsewhere in the web app, e.g. `ChatListItem.tsx`) and wrapped only the `<img>`/placeholder in a `Link` to the pack route with `aria-label="Open sticker pack"` and `cursor-pointer`. The outer `<div>` and the time/ticks pill are untouched, so the bubble's right-click menu (`MessageBubble.tsx` `onContextMenu`) still works.
- No tests added (UI, per the spec). Both files are under 400 lines.

### Checks run
- `pnpm install` (from repo root): completed with no output.
- `pnpm gate`: ended with `GATE PASS`; summary lines:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.9s)
  PASS  lint  (1.3s)
  PASS  typecheck  (7.4s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/mobile  (2.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No individual test files were run: the change is UI-only and the spec says no tests.

### Notes for the lead
- Web selection mode: `MessageBubble`'s outer `onClick` toggles selection while `selecting`, but it does not `preventDefault`, so clicking a sticker in selection mode also follows the new link. Fixing it needs a `selecting` prop passed into `StickerMessage` (i.e. an edit to `MessageBubble.tsx`, outside this task's Allowed files), so I left it. The same applies to double-click-to-reply, which is inherently replaced by single-click-to-open on stickers.
- Phone: I kept `accessibilityRole="image"` as the spec asked; a tappable element would ideally be `button`/`link`, but changing the role was not in the spec.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `97515a90d`.
- **Smoke:** passes on the emulator (mock). The mock data has no sticker messages, so I couldn't tap one on screen; Julio will check on his phone.
- **Code:**
  - phone: `onPress` pushes `/stickers/${pack_id}`, and the long-press menu is kept;
  - web: only the image is wrapped in a `Link` to `/stickers/:packId`, and the pill and the outer element stay as they were.
- **Follow-up (pre-review):** in selection mode a sticker click navigates instead of selecting. That goes into the next fix batch for both apps.

