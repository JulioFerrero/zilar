---
id: T-1340
title: "Web photo viewer fix (T-1339 follow-up): double-clicking the photo closes the viewer instead of zooming, and double-click while zoomed does nothing; a click on the photo must never close, only a click outside it"
status: merged
milestone: M5
branch: task/T-1340-web-viewer-dblclick
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1340: Web viewer double-click

## Spec (written by Claude, do not edit)

### Why
The lead's live check of T-1339 on chat.zilar.app (Playwright Chromium, @claude_test DM, 2 photos), 2026-10-13. Working: wheel zoom (→ `matrix(2.2…)`), drag pan, the ← arrow (2/2 → 1/2), and → hidden at the end. Broken:
1. **At 1x, `dblclick` at the centre of the photo** (its box was 756×756 at x 262, y 60) **closes the viewer.** The dialog is gone after the first click. `MediaViewer.tsx` closes on a backdrop click at 1x "only when the gesture did not move and the target is the empty area" (Report), but the photo's own clicks evidently reach that close path; check whether the `<img>` has `pointer-events: none` or the handler checks the wrong target.
2. **While zoomed (2.2x), `dblclick` does nothing**: the transform is unchanged. It should go back to 1x.

### What to build
1. A click or double-click **on the photo** never closes the viewer. Only a single click on the empty area outside the photo closes it at 1x. Compare against the photo's rendered box (the `object-contain` area, not the full `<img>` box) or use the event target; say which.
2. Double-click on the photo toggles 2.5x at the point and back to 1x, at any zoom (zoomed → 1x).
3. A single click on the photo does nothing.
4. Keep everything else from T-1339. Files: `apps/web/src/components/media/MediaViewer.tsx` (201 lines), `apps/web/src/components/media/useZoomPan.ts` (377 lines: keep at most 400). **No tests** (UI).

### Read first
`AGENTS.md`, `work/T-1339-web-viewer-zoom.md` (Report), `apps/web/src/components/media/MediaViewer.tsx`, `apps/web/src/components/media/useZoomPan.ts`.

### Allowed files
`apps/web/src/components/media/MediaViewer.tsx`, `apps/web/src/components/media/useZoomPan.ts`, `apps/web/src/components/media/zoomGeometry.ts`, `work/T-1340-web-viewer-dblclick.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's live check:**
  - `dblclick` on the photo zooms and the dialog stays open;
  - a second `dblclick` returns to 1x;
  - a click outside the photo closes.

---

## Report (written by the worker when done)

### What I did

**Root cause.** T-1339's viewport calls `setPointerCapture` on the pointer
during `pointerdown` (for the pan/swipe gestures). While the capture is held,
the browser retargets the compatibility mouse events to the capturing element,
so the `click` and `dblclick` targets become the viewport (the common ancestor
of the `mousedown` and retargeted `mouseup`), not the `<img>`. That broke both
symptoms:
- `onBackdropClick` tested `event.target !== event.currentTarget`; with the
  target retargeted to the viewport the test was false, so a click on the photo
  fell through to `onClose()` — the viewer closed on the first click of the
  double-click.
- `onDoubleClick` tested `event.target !== image`; the retargeted target is the
  viewport, so the handler returned and the zoom never toggled (the "does
  nothing while zoomed" symptom).

**Fix: test the click point against the photo's painted box, not the event
target.** New `zoomGeometry.ts` computes the photo's painted rectangle:
`getBoundingClientRect()` of the `<img>` (which already includes the zoom
`transform`) trimmed to the `object-contain` area using `naturalWidth/Height`
(it letterboxes inside its box when the ratios differ). `isPointOnImage` then
answers whether a viewport-coordinate point is on the photo.
- `MediaViewer.tsx` `onBackdropClick` now closes only at 1x, only when the
  gesture did not move, and only when the click is **off** the painted photo. A
  click on the photo (single, or the first of a double) does nothing.
- `useZoomPan.ts` `onDoubleClick` now toggles when the point is **on** the
  painted photo: 1x → 2.5x at the point, and any zoom → 1x.

I used the rendered (object-contain) box rather than the event target: the
target is unreliable under pointer capture, and comparing coordinates also lets
the letterbox area keep its close behaviour.

### Files changed

- `apps/web/src/components/media/zoomGeometry.ts` (new, 60 lines)
- `apps/web/src/components/media/useZoomPan.ts` (modified, 384 lines)
- `apps/web/src/components/media/MediaViewer.tsx` (modified, 209 lines)
- `work/T-1340-web-viewer-dblclick.md` (this file)

All inside the task's Allowed files.

### Commands and real results

- `pnpm install`: done (12.4s; same pre-existing `@types/react-dom` peer
  warning in `apps/mobile`).
- `pnpm gate` (from the repo root, final run):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (2.7s)
  PASS  format  (3.3s)
  PASS  lint  (2.1s)
  PASS  typecheck  (1.8s)
  PASS  effect  (1.3s)
  PASS  tests @zilar/web  (11.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Single tests run while working

None. The change is UI-only, the spec says "No tests (UI)", and no test file
was touched; `pnpm gate`'s nearest-tests step ran the `@zilar/web` package tests
(12.8s) and they passed.

### Problems / deviations

- The behaviour is reasoned from the code and the live-check symptoms; I did not
  reproduce it in a browser myself (no e2e harness for the viewer), so the
  acceptance still rests on the lead's live check. I say this rather than claim
  I tested it.
- No other deviations. Every file is under 400 lines.

### Open questions

None.

### Security checklist

Not applicable: a client-side UI overlay with no data access, no route, no
secrets, no deletes or writes.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (0 nits); the packet is current for `31f5bba2`.** Web tsc: 0 errors; `useZoomPan.ts` is 384 lines and `zoomGeometry.ts` 60. The lead checks it live after the deploy (the mock has no images).
