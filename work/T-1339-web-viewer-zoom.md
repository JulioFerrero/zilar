---
id: T-1339
title: "Web photo viewer like Telegram Web (parity with T-1338): zoom with the wheel/trackpad pinch and double-click, drag to pan when zoomed, swipe between photos on touch screens, plus on-screen prev/next arrows"
status: merged
milestone: M5
branch: task/T-1339-web-viewer-zoom
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1339: Web viewer zoom and swipe

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, wants photos he taps to support swiping to the other photos, and pinch or double-tap to zoom and move (said about the phone; parity rule: web too). The web viewer `apps/web/src/components/media/MediaViewer.tsx` (179 lines, T-1232) has only ArrowLeft/ArrowRight keys (`:103-108`): no zoom, no pan, no touch swipe.

### What to build
1. **Zoom 1–4x:**
   - mouse wheel and trackpad pinch (`wheel` with `ctrlKey` is a pinch on macOS), zooming toward the cursor;
   - double-click toggles 2.5x at the clicked point and back to 1x;
   - on touch screens, two-finger pinch (pointer events) around the midpoint.
2. **Pan:** while zoomed, drag with the mouse or one finger, clamped to the image edges; the cursor is `grab`/`grabbing`.
3. **Steps:**
   - at 1x, a horizontal touch swipe steps photos;
   - round **prev/next arrow buttons** on the left and right edges (hidden at the ends) do the same as the arrow keys;
   - zoom resets when the photo changes.
4. Esc still closes, and a click on the backdrop at 1x closes. Keep the existing counter and actions.
5. Use pointer events and CSS transforms only, with no new dependency. Every file stays at most 400 lines (put the zoom logic in `apps/web/src/components/media/useZoomPan.ts`). **No tests** (UI).

### Read first
`AGENTS.md`, `apps/web/src/components/media/MediaViewer.tsx`, and how it's opened (`useMediaViewer` in `apps/web/src/components/ImageMessage.tsx`).

### Allowed files
`apps/web/src/components/media/MediaViewer.tsx`, `apps/web/src/components/media/useZoomPan.ts`, `apps/web/src/components/media/ViewerArrows.tsx`, `work/T-1339-web-viewer-zoom.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's live or headless check:** wheel zoom, double-click zoom, drag pan, and the arrows step photos.

---

## Report (written by the worker when done)

### What I did

Telegram-like zoom, pan and stepping for the web photo viewer (T-1232's
`MediaViewer`), with all gesture logic in a new hook and no new dependency.

- `apps/web/src/components/media/useZoomPan.ts` (new, 377 lines): the zoom/pan
  hook. It keeps `{ scale, x, y }` (1–4x) and applies it with a single CSS
  `transform: translate(...) scale(...)`, so nothing but transforms move.
  - **Wheel / trackpad pinch:** a native, non-passive `wheel` listener (a React
    `onWheel` is passive, so it could not `preventDefault()` the browser's
    page zoom on a macOS pinch). Zooms toward the cursor; `ctrlKey` wheel is
    handled like any wheel.
  - **Double-click:** toggles 2.5x at the clicked point and back to 1x.
  - **Touch pinch:** two pointers, `scale = origin.scale * distance / start`,
    around the moving midpoint.
  - **Pan:** one pointer while zoomed, offset from the gesture origin, clamped
    to the image edges (`clampState`) so no gap opens; a lifted finger in a
    pinch keeps panning/swiping.
  - **Swipe at 1x:** a non-mouse horizontal drag past 60px (dominant over
    vertical) calls `onSwipe(-1 | 1)`.
  - Zoom resets when the photo changes by deriving the shown state from a
    `resetKey` (the photo's message id) during render, so no effect/setState is
    needed.
- `apps/web/src/components/media/ViewerArrows.tsx` (new, 45 lines): the round
  prev/next keys pinned to the left/right edges, hidden at the ends, using the
  existing `IconButton` (`key-icon`, `radius={999}`) and lucide chevrons.
- `apps/web/src/components/media/MediaViewer.tsx` (changed, 201 lines): the
  flex area is now a full-bleed viewport that owns the pointer handlers, the
  transformed `<img>` (cursor `grab`/`grabbing` while zoomed), the backdrop
  click (closes only at 1x, only when the gesture did not move and the target
  is the empty area) and the `ViewerArrows`. The counter, close key, Escape,
  ←/→ keys, focus trap and "Open original" are unchanged. The old inline
  chevron buttons were replaced by `ViewerArrows`.

### Files changed

- `apps/web/src/components/media/MediaViewer.tsx` (modified)
- `apps/web/src/components/media/useZoomPan.ts` (new)
- `apps/web/src/components/media/ViewerArrows.tsx` (new)
- `work/T-1339-web-viewer-zoom.md` (this file)

All inside the task's Allowed files.

### Commands and real results

- `pnpm install`: done in 14.7s (peer warning about `@types/react-dom` in
  `apps/mobile`, pre-existing and unrelated).
- `pnpm gate` (final run, from the repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.2s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.4s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/web  (2.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  An earlier run failed lint on the new hook (`react(refs)` for a ref write
  during render and `react(set-state-in-effect)` for the reset effect); both
  were fixed by deriving the reset state during render and syncing the wheel
  handler's ref in an effect.

### Single tests run while working

None. The change is UI-only (no test file touched) and the spec says "No
tests (UI)"; the gate's nearest-tests step ran the `@zilar/web` package tests
(2.8s) and they passed.

### Problems / deviations

- The image is now full-bleed (the old `p-4` padding on the image row is gone)
  so the viewport measures exactly and a zoomed photo can use the whole area;
  this matches Telegram and the spec's "full-screen" intent.
- A double-click zooms only when it lands on the photo (the letterbox area
  keeps its single-click-to-close behaviour), which avoids a first click of a
  double-click closing the viewer. On touch, pinch is the zoom gesture.
- No other deviations. Every file is under 400 lines.

### Open questions

None.

### Security checklist

Not applicable: a client-side UI overlay with no data access, no route, no
secrets, no deletes or writes.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit); the packet is current for `3cd9e33e`.**
- **Lead's checks:** web tsc: 0 errors; files are 201, 45 and 377 lines.
- **Not checkable in the mock:** the mock doesn't load images, so the viewer can't open on a photo there. The lead checks it live after the deploy, in the @claude_test DM, which has two photos (wheel and double-click zoom, drag, arrows).
