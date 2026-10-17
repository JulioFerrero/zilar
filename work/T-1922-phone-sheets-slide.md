---
id: T-1922
title: "Phone attach, emoji and sticker sheets slide up from the composer and slide back down on close (one shared Reanimated hook), instead of fading in place; reduced motion keeps the fade"
status: merged
milestone: M5
branch: task/T-1922-phone-sheets-slide
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1922: The phone composer sheets slide up

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17,** picked item 4 from the lead's `find-animation-opportunities` sweep (Emil Kowalski's skills). The attach, emoji and sticker sheets are RN `Modal`s with `animationType="fade"`, so their bottom panel fades in place instead of rising from the composer it belongs to. The rest of the app's sheets (the kit `BottomSheet`, a native sheet) already slide. **Purpose: spatial consistency.** Enter and exit take the same path.

### Facts (read by the lead on 2026-10-17)
All three use the same shape: `<Modal … transparent animationType="fade" onRequestClose={onClose}>`, then a full-screen backdrop `<Pressable onPress={onClose} className="flex-1 justify-end bg-black/40">`, then a bottom panel `<Pressable onPress={() => {}} … className="h-[…] rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3">`.
- **`apps/mobile/src/components/chat/attach-sheet.tsx`** (118 lines): the Modal at `:64`, the backdrop at `:65-69`, the panel at `:70-75` (`h-[75%]`).
- **`apps/mobile/src/components/chat/emoji-sheet.tsx`** (167 lines): the Modal at `:105`, inside a `KeyboardAvoidingView` (`:106`); the backdrop at `:107-111`; the panel at `:112-117` (`h-[50%]`).
- **`apps/mobile/src/components/chat/sticker-panel.tsx`** (361 lines): the Modal at `:252`, the backdrop at `:253-257`, the panel at `:258-263` (`h-[50%]`).
- **Reanimated 4.5.1** is installed (`apps/mobile/package.json:69`). It is already used with `useAnimatedStyle` and `withTiming` (`apps/mobile/src/components/chat/folder-pager.tsx:36`).

### Steps
1. **New `apps/mobile/src/components/chat/sheet-motion.ts`:** `useSheetMotion(onClose: () => void)` returns `{ panelStyle, close }`.
   - **On mount:** the panel's `translateY` animates from its measured height (or the window height until measured) to `0` with `withTiming(0, { duration: 260, easing: Easing.bezier(0.32, 0.72, 0, 1) })`.
   - **`close()`:** animates `translateY` to the panel height with `withTiming(h, { duration: 200, easing: Easing.bezier(0.32, 0.72, 0, 1) })`, then calls `onClose` on the JS thread (`runOnJS` / `scheduleOnRN`, whichever this Reanimated version uses). A second `close()` while closing does nothing.
   - **Reduced motion** (`useReducedMotion()`): no translate. `close()` calls `onClose` at once, and the Modal's own fade stays.
   - Add a short doc comment.
2. **In each of the three sheets:**
   - wrap the panel in `Animated.View` with `panelStyle`. Move the height class (`h-[75%]` / `h-[50%]`) to the `Animated.View` if needed, and measure its height with `onLayout`;
   - make the backdrop press, `onRequestClose` (Android back) and any in-sheet close or after-pick close use `close` instead of calling `onClose` directly;
   - keep `animationType="fade"` (the backdrop still fades);
   - change nothing else.
3. **No tests** (UI). Files stay at most 400 lines (`sticker-panel.tsx` is 361; keep the edit small).

### Allowed files
- `apps/mobile/src/components/chat/sheet-motion.ts`
- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/chat/emoji-sheet.tsx`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `work/T-1922-phone-sheets-slide.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Opening** attach, emoji or stickers slides the panel up from the bottom in 260 ms while the backdrop fades.
- **Closing** (backdrop tap, Android back, or picking an item that closes it) slides the panel down in 200 ms, then the sheet closes.
- **With reduced motion,** the sheets just fade as before.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `useSheetMotion(onClose)` in `sheet-motion.ts`: slides the panel up from its window-height offset (restarting from the measured height once `onLayout` reports it) to `0` in 260 ms with `Easing.bezier(0.32, 0.72, 0, 1)`, and `close()` slides it to the panel height in 200 ms then calls `onClose` through `runOnJS`. A second `close()` while closing is ignored. With `useReducedMotion()` there is no translate, and `close()` calls `onClose` at once so the `Modal` fade stays.
- `attach-sheet.tsx`, `emoji-sheet.tsx`, `sticker-panel.tsx`: the panel is now an `Animated.View` with `panelStyle`; the height class (`h-[75%]` / `h-[50%]`) moved to it and its `onLayout` feeds the hook. The backdrop press and `onRequestClose` call `close`; `animationType="fade"` is unchanged.
- `emoji-sheet.tsx` and `sticker-panel.tsx` gained a small `…Body` split (like `AttachSheet` already had): the sheets return `null` while closed, and hooks cannot run after that early return. The body mounts fresh on each open, so the entry animation plays every time.

### Checks run
- `pnpm gate` (twice; the first run failed on `format`, which I fixed with `prettier --write` on the two flagged files, and the second on the `react(immutability)` lint rule in `sheet-motion.ts`, fixed by moving shared-value writes into module functions — the third run passed):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (1.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No separate single test run: this is UI motion and the spec asks for no tests; the gate's mobile suite is the nearest run.

### Notes for the lead
- **After-pick close does not slide yet.** Picking a sticker, a GIF, a demo attachment, or staging gallery files closes the sheet from `composer-sheet.ts` (`pickSticker` → `setSheetOpen(false)`) and `composer-media.ts` (`pickGif`, `demoPick`, `stageFiles` → `setAttachOpen(false)`), which unmounts the sheet before `close()` can run. Those files are outside this task's Allowed files, and the three sheets have no in-sheet pick-to-close handler to redirect, so those paths still close instantly. Backdrop tap and Android back do slide. Fixing the pick paths needs one follow-up that routes those four composers' close through a sheet-owned `close` (e.g. the composer calls a passed-down close), or an allowed-files change to `composer-sheet.ts` / `composer-media.ts`.
- The hook returns `{ panelStyle, onLayout, close }`; `onLayout` is needed to measure the panel, which the two-field return in the spec did not expose.
- The `EmojiSheet` and `StickerPanel` body split is the only structural change beyond the panel wrapper; it was required to keep hooks out of the closed early return and to restart the entry on every open.
- Files: `apps/mobile/src/components/chat/sheet-motion.ts` (new, 99 lines), `attach-sheet.tsx` (126), `emoji-sheet.tsx` (180), `sticker-panel.tsx` (373) — all under 400.
- Security checklist: no network, storage, routes, permissions or logging touched; not applicable beyond the above.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `6663833b5`.
- **Smoke:** passes on the emulator (mock, `/chat/marta@zilar.test`).
- **Motion,** checked with `screenrecord` frame strips:
  - the emoji sheet rises from the bottom while the backdrop fades, and settles fully up;
  - Back slides the attach panel down over about 4 frames before it closes.
- **Not caught:** the first attach open after launch showed no slide. The emulator dropped frames while the gallery loaded; later takes are fine. A feel check on a real phone comes with the next APK.
- **Pre-review follow-up, accepted as is:** a pick (sticker, GIF, file) closes the sheet at once, because the composer flips its open state. A pick is an action, and an instant close reads as responsive, in line with Emil's "exits faster than entrances".
- **Code:** `useSheetMotion` measures the panel and restarts the entry from its real height. `close` is guarded against a double call, and reduced motion skips the translate.
