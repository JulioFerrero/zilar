---
id: T-1201
title: "MUX-13 (first step): the mobile full-screen image viewer moves to its own file on reanimated + Gesture API: smooth pinch on the UI thread, pan while zoomed, double-tap zooms in/out, swipe down closes, an X icon closes"
status: merged
milestone: M5
branch: task/T-1201-mobile-image-viewer
model: auto
effort: default
depends_on: [T-1185]
estimate: 0.3 day
---

# T-1201: A smooth image viewer on mobile

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-13 (P2, confirmed by code). The viewer is `AttachmentViewer` in `apps/mobile/src/components/chat/attachment-message.tsx:304-392`. That file is 392 lines, close to the limit.
- **The pinch lags:** it writes `scale` through React `setState` on every gesture event, on the JS thread (`ZoomableImage`, with `handlePinch` at about `:361-366`, using the old `PinchGestureHandler`).
- **Weak gestures:** there's no pan while zoomed, and a double-tap only resets.
- **The only way to close it** is a "Close" text button.
- **What's available:** `react-native-reanimated` 4.5.1 and `react-native-gesture-handler` ~2.32 are installed (`apps/mobile/package.json:60-61`), and the app root has a `GestureHandlerRootView` (`apps/mobile/src/app/_layout.tsx:80`). The viewer's only caller is `apps/mobile/src/components/chat/attachment-body.tsx:117`.
- **Keep:** the T-1185 media source (the `chatId` prop, through `/api/files` with the bearer), and plain `Image` so GIF and WebP still animate.

### What to build
1. **A new `apps/mobile/src/components/chat/image-viewer.tsx`** (at most 200 lines), exporting `AttachmentViewer` with the **same props**. Move the viewer and `ZoomableImage` out of `attachment-message.tsx`, and re-export from there, or update the one import in `attachment-body.tsx`.
2. **Gestures** with `Gesture.Pinch`, `Gesture.Pan` and `Gesture.Tap({ numberOfTaps: 2 })`, composed with `Gesture.Simultaneous` or `Gesture.Exclusive` as needed, on reanimated shared values. No `setState` per frame.
   - **pinch:** zoom between 1x and 4x around the focal point if it's simple, or the centre;
   - **pan:** move the image while zoomed, clamped so it can't leave the screen;
   - **double-tap:** to 2.5x when at 1x, back to 1x otherwise, animated;
   - **at 1x, a vertical drag down** moves the image and fades the backdrop. Past about 120 px or a fast fling it closes (`runOnJS(onClose)`); otherwise it springs back.
3. **An `X` icon button** (lucide `X`, `accessibilityLabel="Close viewer"`) top-right inside the safe area, replacing the text button. Android back still closes it (`onRequestClose`).
4. **On Android, an RN `Modal` needs its own `GestureHandlerRootView`** inside it, or the gestures don't fire. Wrap the modal content.
5. **No share or pager in this step**, and no new dependency. **No tests** (UI).

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-13), `apps/mobile/src/components/chat/attachment-message.tsx:290-392`, `apps/mobile/src/components/chat/attachment-body.tsx:100-130` and `apps/mobile/src/app/_layout.tsx:75-85`.

### Allowed files
`apps/mobile/src/components/chat/image-viewer.tsx`, `apps/mobile/src/components/chat/attachment-message.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `work/T-1201-mobile-image-viewer.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- `attachment-message.tsx` gets shorter, and `image-viewer.tsx` is at most 200 lines.
- **The lead's check on the emulator:** open a photo, pinch, pan, double-tap, swipe down to close, and X closes.

---

## Report (written by the worker when done)

### What I did
- Created `apps/mobile/src/components/chat/image-viewer.tsx` (192 lines): moved `AttachmentViewer` with the same props (`chatId`, `url`, `name`, `onClose`) plus the zoom logic out of `attachment-message.tsx`.
- Gestures use the Gesture API + reanimated shared values, no `setState` per frame: `Gesture.Pinch` zooms 1x–4x (re-clamps pan to the new zoom level), `Gesture.Pan` moves the image while zoomed (clamped so it can't leave the screen), `Gesture.Tap({ numberOfTaps: 2 })` toggles 2.5x / 1x animated, and at 1x a vertical drag moves the image and fades the backdrop — past 120 px or a fast fling (>800 px/s) it closes via `runOnJS(onClose)`, otherwise it springs back. Composed as `Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan))`.
- Close: lucide `X` icon button (`accessibilityLabel="Close viewer"`) top-right inside the safe area, replacing the text button; `Modal onRequestClose` still closes on Android back.
- Modal content wrapped in its own `GestureHandlerRootView` (Android requirement). Kept the T-1185 media source (`useMediaSource` with `chatId`, bearer via `/api/files`) and plain `expo-image` so GIF/WebP still animate.
- `attachment-message.tsx` now just re-exports `AttachmentViewer` from `./image-viewer` and dropped the `Modal`/`PinchGestureHandler`/`useSafeAreaInsets`/`MediaSource` imports plus `ZoomableImage` (392 → 299 lines). `attachment-body.tsx` needed no change (same export path). No new dependency, no tests (UI, per spec).

### Files changed
- `apps/mobile/src/components/chat/image-viewer.tsx` (new, 192 lines — under the 200 limit)
- `apps/mobile/src/components/chat/attachment-message.tsx` (viewer + `ZoomableImage` removed, re-export added; 392 → 299 lines)
- `work/T-1201-mobile-image-viewer.md` (this report + status)

### Commands and real results
- `pnpm install`: done (11.2s).
- `pnpm gate` from repo root: **GATE PASS** — `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `SKIP tests @zilar/mobile (no nearby test files)`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`. Gate sees 3 changed files against main (the 2 source files + this task file).
- Single tests: none run — the spec says no tests (UI), and the gate found no nearby test files for `@zilar/mobile` (SKIP). No bare `turbo test` / unfiltered runs.
- `grep` for `eslint-disable|oxlint-disable|@ts-ignore|console.log|: any|as any` in both touched source files: no hits.

### Problems / deviations
- `pnpm gate` lint initially failed with `react(immutability)` errors on every `sharedValue.value =` write — the rule flags standard reanimated shared-value mutation as hook-result mutation. Verified with probe files that writing via a `SharedValue` passed as a function parameter does not trip it, so the gesture builders (`makePinch`/`makePan`/`makeDoubleTap`) take the values bundled in a `ViewerMotion` param instead of closing over the hook results directly. No disable comments, no rule changes. (Note: `pnpm gate` runs `install` fresh, which reformats nothing; prettier on the new file was applied via `pnpm --filter @zilar/mobile exec prettier --write` on the touched files only.)
- Verified `useSharedValue`/`GestureDetector` are the installed reanimated 4.5.1 / gesture-handler ~2.32 APIs; root `GestureHandlerRootView` confirmed in `apps/mobile/src/app/_layout.tsx:80`. The T-1185 `useMediaSource(chatId, url, enabled)` call is unchanged from the old viewer.

### Open questions
- None. Gesture behavior (pinch/pan/double-tap/swipe-down/X) needs the lead's emulator check per Acceptance.

### Security checklist
- No secrets/tokens logged; the bearer stays in `useMediaSource` headers as before.
- No deletes/updates, caps, permissions, routes, or audit entries touched. N/A otherwise.

### Fix round (PREREVIEW.md: 1 must-fix, 0 should-fix, 0 nits)
- Finding 1 (must-fix, `image-viewer.tsx:52`): removed the inner non-worklet `clamp` closure from `makePinch` and call the worklet `clampPan` directly in the pinch `onUpdate`, so pinch-to-zoom no longer throws on the UI thread. One commit: `T-1201: fix finding 1 - ...`.
- Disagreements: none.
- Tests added: none — spec §5 says no tests (UI) and the finding names no test; gate reports `SKIP tests @zilar/mobile (no nearby test files)`.
- `pnpm gate` from repo root: **GATE PASS** — `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `SKIP tests @zilar/mobile (no nearby test files)`, `scope: every changed file is inside the Allowed files`, `migration: every added migration continues from the base`.

## Review (written by Claude)

**Lead, 2026-10-12: approved, after 1 auto round. The pre-review is clean, with 1 nit.**
- **The new `image-viewer.tsx`** (193 lines): the same `AttachmentViewer` props.
  - Pinch, Pan and a double tap on reanimated shared values (worklets; the round removed a non-worklet `clamp` wrapper, so the pinch `onUpdate` now calls the worklet `clampPan` directly);
  - swipe down at 1x closes (`runOnJS(onClose)`), with an X icon;
  - its own `GestureHandlerRootView` inside the `Modal`.
- **`attachment-message.tsx`** went from 392 to 299 lines. The T-1185 media source is kept.
- **Still to do:** the emulator or phone check. The test account's chat has no photo, so it waits for Julio's phone test or a chat with media.
