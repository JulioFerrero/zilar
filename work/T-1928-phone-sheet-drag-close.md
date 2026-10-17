---
id: T-1928
title: "Phone attach sheet (and the other custom sheets on useSheetMotion) can be dragged down to close: a pan on the grabber/header follows the finger, a fast or long drag dismisses, a short one springs back"
status: merged
milestone: M5
branch: task/T-1928-phone-sheet-drag-close
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1928: Drag a sheet down to close it

## Spec (written by Claude, do not edit)

### Why
**Julio, 2026-10-17, on the iPhone:**

> most of the drawer i cant grab and move and close i have to click out to close

The kit `BottomSheet` (native TrueSheet) already drags to close. The custom RN-`Modal` sheets don't.

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/sheet-motion.ts`** (99 lines, T-1922):
  - `useSheetMotion(onClose)` returns `{ panelStyle, onLayout, close }`;
  - the panel's `translateY` shared value is `offset`. It enters with `withTiming(0, 260 ms, Easing.bezier(0.32, 0.72, 0, 1))` and `close()` slides it to the measured `height` over 200 ms, then `runOnJS(onClose)`;
  - a `closing` ref guards a double close, and `useReducedMotion()` skips the translate.
- **`apps/mobile/src/components/chat/attach-sheet.tsx`** (127 lines): the panel's top holds the grabber `View` (`mb-1 h-1 w-10 self-center rounded-full bg-surface-raised`) and the header row with the "Attach" title. The body below is the gallery grid, a scroll view.
- **`apps/mobile/src/components/chat/sticker-panel.tsx`:** it uses the same hook and the same grabber.
- `react-native-gesture-handler` ~2.32 and Reanimated 4.5.1 are installed. `swipe-to-reply.tsx` and `folder-pager.tsx` already use `Gesture.Pan`.

### Steps
1. **`sheet-motion.ts`:** also return `dragGesture: Gesture.Pan()` (from `react-native-gesture-handler`).
   - `onUpdate`: `offset.value = e.translationY > 0 ? e.translationY : e.translationY * 0.2`. Pulling up rubber-bands.
   - `onEnd`: if `e.translationY > height * 0.3` or `e.velocityY > 800`, slide to `height` with `withTiming(height, { duration: 200, easing: Easing.bezier(0.32, 0.72, 0, 1) })` and then call `onClose` on the JS thread (reuse the `close` path so the `closing` guard holds). Otherwise spring back with `withSpring(0, { damping: 30, stiffness: 300 })`.
   - With reduced motion, the drag still follows the finger (direct manipulation), but a dismiss calls `onClose` at once.
   - Update the doc comment.
2. **`attach-sheet.tsx`:** wrap the grabber and the header row (not the scrolling body) in `<GestureDetector gesture={dragGesture}>`, so dragging the top of the sheet moves it and the grid keeps scrolling. Give that area enough height to grab, at least the grabber's `py-2`.
3. **`sticker-panel.tsx`:** the same, on its grabber and title.
4. **No tests** (UI). Files stay at most 400 lines.

### Allowed files
- `apps/mobile/src/components/chat/sheet-motion.ts`
- `apps/mobile/src/components/chat/attach-sheet.tsx`
- `apps/mobile/src/components/chat/sticker-panel.tsx`
- `work/T-1928-phone-sheet-drag-close.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Dragging the top of the attach sheet down** moves it with the finger.
- **Letting go** past about a third of its height, or with a quick flick, slides it away and closes it. A short drag springs back.
- **The photo grid** still scrolls normally.
- Tapping outside still closes it.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- **`sheet-motion.ts`**: `useSheetMotion` now also returns `dragGesture` (`Gesture.Pan()`), made from `react-native-gesture-handler`:
  - `onUpdate` follows the finger (`translationY` down, 20 % resistance when pulling up).
  - `onEnd` dismisses when the drag passed 30 % of the measured panel height (`DISMISS_RATIO`) or the velocity passed 800 px/s (`DISMISS_VELOCITY`), by calling the existing `close` on the JS thread via `runOnJS` — so the exit animation, its 200 ms/easing and the double-close guard are the same as a tap outside. Otherwise it springs back with `withSpring(0, { damping: 30, stiffness: 300 })`.
  - The old `closing` ref became a shared value (`exiting`, read from the gesture's worklets) so a drag that starts during the exit cannot cancel the close animation and strand the panel. `close` itself is still idempotent.
  - Reduced motion: the drag still writes `offset` directly (direct manipulation), and a dismiss goes through `close`, which calls `onClose` at once (the entry/exit transitions still skip the translate, as before). A short drag still springs back.
  - Doc comment updated.
- **`attach-sheet.tsx`**: the grabber and the "Attach" header row (not the gallery) are wrapped in `<GestureDetector gesture={dragGesture}>`, inside a `py-2` `View` so the grab area is at least the grabber plus padding. The scrolling body is untouched.
- **`sticker-panel.tsx`**: same treatment for the grabber and the "Stickers" title.
- Both Modals now wrap their content in `GestureHandlerRootView`: gestures do not fire inside an RN `Modal` on Android without one (same pattern as `image-viewer.tsx`). This was needed for the feature to work at all on Android and stayed inside the Allowed files.

### Checks run
- `pnpm install` — no output, exit 0.
- `pnpm gate` — **GATE PASS**, 4 changed files against main:
  - `PASS install (frozen) (1.5s)`
  - `PASS format (0.5s)`
  - `PASS lint (0.7s)`
  - `PASS typecheck (4.3s)`
  - `PASS effect (1.6s)`
  - `PASS tests @zilar/mobile (1.9s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `images: every workspace package an app image needs is copied into its Dockerfile`
  - `size: every changed source file is within 400 lines`

No single test file exists for these screens or the hook (spec says no tests), so none was run individually; the gate's mobile suite passed.

### Notes for the lead
- **Not tested on a device/emulator**: I could not run the app, so the acceptance items (drag follows finger, dismiss vs spring back, grid still scrolls, tap outside) are verified by code reading only. They need the phone smoke.
- `emoji-sheet.tsx` also uses `useSheetMotion` but is not in the Allowed files, so it does not attach the gesture yet; wiring it is a one-line `<GestureDetector>` change if wanted.
- The gesture is attached only to the header area, not the body, so the gallery/sticker `ScrollView` keeps its own vertical scroll.

## Review (written by Claude)

Merged on 2026-10-18; the packet matches HEAD `1b4ba9a05`.
- **Smoke:** passes on the emulator (mock, `/chat/marta@zilar.test`). The first run's failure was transient, and the rerun passed.
- **Checked with `adb input swipe`:**
  - a fast 1200 px swipe down on the attach sheet's header closes it, and the "Attach" header is gone;
  - a slow 120 px drag springs back to the same bounds (`[115,697][257,760]`).
- **Follow-up (the emoji sheet has no drag) no longer applies:** T-1927 made the emoji panel an inline dock under the input.

