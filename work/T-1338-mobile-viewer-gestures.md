---
id: T-1338
title: "Mobile photo viewer gestures actually work: swipe left/right between photos, pinch to zoom, drag to move a zoomed photo, double-tap zoom, swipe down to close — today only double-tap works (the double-tap gesture blocks the others)"
status: dropped
milestone: M5
branch: task/T-1338-mobile-viewer-gestures
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1338: Mobile viewer gestures

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, on his Android phone (build `291f2d59`): "when I click it opens, but only double tap makes a zoom; I can't move the image or anything, and the pinch with two fingers does nothing". He wants to swipe to the other photos, and pinch or double-tap to zoom and move.

The viewer is `apps/mobile/src/components/chat/image-viewer.tsx` (144 lines; RN `Modal` + its own `GestureHandlerRootView`). The gestures are in `apps/mobile/src/components/chat/photo-pager.tsx` (209 lines):
- `makePinch` (`:45-59`), `makePan` (`:67-119`) and `makeDoubleTap` (`:122-134`);
- composed as `Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan))` (`:196`).

`react-native-gesture-handler ~2.32.0` and `react-native-reanimated 4.5.1` (`apps/mobile/package.json:63-64`).

**Likely cause** (the lead's reading; verify it):
- `Exclusive(doubleTap, …)` makes pinch and pan wait for the double-tap to **fail**;
- a `Tap` with no `maxDistance` / `maxDeltaX` doesn't fail when the finger drags, and a second finger doesn't fail it either;
- so pan and pinch never activate, and only the double-tap works.

Also check the reanimated 4 babel setup: are the gesture callbacks workletized (`react-native-worklets/plugin` in `apps/mobile/babel.config.js`)? Say what you found.

### What to build
1. **Composition:** pinch, pan and double-tap all work.
   - Give the double-tap `.maxDistance(10)` (and `.maxDuration(250)`, `.maxDelay(250)`) so a drag or a second finger fails it at once.
   - Compose as `Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan))`, or an equivalent that doesn't make pan or pinch wait.
   - Pan gets `.minDistance(4)`; for the 1x horizontal swipe, `.activeOffsetX([-12, 12])` plus a vertical offset for dismiss, if that keeps both working.
2. **Behaviour** (Telegram-like):
   - at 1x, a horizontal swipe goes to the next or previous photo, and a vertical drag down closes;
   - pinch zooms 1–4x around the pinch focal point (use `event.focalX/focalY`), and releasing below 1x springs back to 1x;
   - while zoomed, a one-finger drag pans, clamped to the image edges;
   - double-tap zooms to 2.5x **at the tapped point**, and double-tap again resets.
   - The swipe only steps photos when not zoomed.
3. **Keep:** the "3 / 12" counter, Save, Close and the swipe-down dismiss.
4. Every file stays at most 400 lines. **No tests** (gestures/UI).

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/photo-pager.tsx`, `apps/mobile/src/components/chat/image-viewer.tsx`, `apps/mobile/babel.config.js`, the RNGH 2 docs on `Gesture.Race`/`Exclusive` and `Tap.maxDistance`.

### Allowed files
`apps/mobile/src/components/chat/photo-pager.tsx`, `apps/mobile/src/components/chat/image-viewer.tsx`, `apps/mobile/src/components/chat/photo-gestures.ts`, `apps/mobile/babel.config.js`, `work/T-1338-mobile-viewer-gestures.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator:** a swipe steps photos, and a drag pans when zoomed (adb swipe).
- **Julio's check on his phone:** pinch, drag and swipe all work.

---

## Report (written by the worker when done)

## Review (written by Claude)
Lead, 2026-10-14: dropped, never merged. Superseded by T-1341 (mobile viewer on react-native-zoom-toolkit, which Julio called perfect). The worktree and branch were deleted unmerged during the 10-14 cleanup Julio approved.
