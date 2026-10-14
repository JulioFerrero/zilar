---
id: T-1343
title: "Web photo viewer on yet-another-react-lightbox (twin of T-1341): replace the hand-rolled MediaViewer zoom/pan/swipe (useZoomPan, zoomGeometry, ViewerArrows) with the library and its Zoom plugin"
status: merged
milestone: M5
branch: task/T-1343-web-lightbox
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1343: Web viewer on a lightbox

## Spec (written by Claude, do not edit)

### Why
The library audit (T-1342, row 2). The web viewer's zoom is hand-rolled:
- `apps/web/src/components/media/useZoomPan.ts` (384 lines), `zoomGeometry.ts` (60) and `ViewerArrows.tsx` (45), driven by `MediaViewer.tsx` (209);
- it already needed two fix rounds (T-1339, then T-1340 for pointer-capture retargeting).

The phone viewer moved to a library (T-1341) and Julio called it "perfect".

### Library rule (Julio, 2026-10-13)
Use the named library; do **not** hand-roll its behaviour. First check it with `npm view <pkg> version time.modified peerDependencies` and confirm it fits the app (web: React 19 / Vite; mobile: Expo SDK 57, RN new architecture, reanimated 4.5.1, RNGH ~2.32.0). Pin an exact version at least two weeks old. If it does not fit, set `status: blocked` and report instead of hand-rolling. Every file stays at most 400 lines. **No tests** (UI). The plan is `docs/audit/library-plan.md` (T-1342, on branch `task/T-1342-library-audit` until it merges; the row is quoted below).

### What to build
1. **Add `yet-another-react-lightbox`** (audit: 3.32.2, 2026-07-30, peers React ^19 OK) to `apps/web/package.json`, and import its `styles.css`.
2. **Rewrite `MediaViewer.tsx`** on `<Lightbox>` with the **Zoom** plugin (wheel/trackpad pinch, double-click, drag pan, touch pinch), plus the **Counter** plugin if it fits ("3 / 12"):
   - swipe and arrows come built in;
   - Escape and a backdrop click close.
   - Keep the exported API that `apps/web/src/components/ImageMessage.tsx`, `message/AlbumGrid.tsx` and `routes/ChatView.tsx` use, so those files don't change.
   - Keep the album scoping (`MediaViewer.tsx:76-93`: album members first, then the rest of the chat) and the source rule (`trusted-media.ts` / `mediaSrc`: an untrusted URL is never fetched).
   - Keep "Open original" and Download if the current viewer has them, as toolbar buttons.
   - Style it to the app's dark kit, with no white flashes.
3. **Delete** `useZoomPan.ts`, `zoomGeometry.ts` and `ViewerArrows.tsx`. If `MediaViewer.tsx` no longer uses `apps/web/src/components/ui/use-modal.ts`, leave that file alone (T-1344 owns it).

### Read first
`AGENTS.md`, `apps/web/src/components/media/MediaViewer.tsx`, `apps/web/src/components/media/useZoomPan.ts`, `apps/web/src/components/media/trusted-media.ts`, `work/T-1341-viewer-zoom-toolkit.md`.

### Allowed files
`apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/components/media/MediaViewer.tsx`, `apps/web/src/components/media/useZoomPan.ts`, `apps/web/src/components/media/zoomGeometry.ts`, `apps/web/src/components/media/ViewerArrows.tsx`, `apps/web/src/components/media/lightbox-theme.css`, `apps/web/src/components/media/viewerSlides.ts`, `work/T-1343-web-lightbox.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's live check after the deploy:**
  - wheel zoom, double-click zoom, drag pan;
  - the arrows step photos, and the counter is right;
  - Escape closes.

---

## Report (written by the worker when done)

### What I did

Replaced the hand-rolled web viewer with `yet-another-react-lightbox`'s `Lightbox`
plus its **Zoom** and **Counter** plugins (the twin of T-1341 on mobile).

- Added `yet-another-react-lightbox: 3.32.2` to `apps/web/package.json` (pinned
  exact) and ran `pnpm install`.
- Rewrote `MediaViewer.tsx` on `<Lightbox open index slides plugins on ...>`:
  - `slides` from a new `viewerSlides.ts` (`{ src, alt }` per photo);
  - **Zoom** plugin with `scrollToZoom: true` (plain wheel and trackpad
    ctrl+wheel pinch both zoom toward the cursor), double-click zoom and drag
    pan are the plugin defaults; `maxZoomPixelRatio: 2`;
  - **Counter** plugin for the "3 / 12" badge (top-left, its default slot);
  - swipe and the edge arrows are the library's carousel/navigation, kept
    non-wrapping with `carousel={{ finite: true }}` to match the old clamped
    stepping;
  - `controller={{ closeOnBackdropClick: true }}` and the default
    `closeOnEscape: true` give the backdrop-click and Escape closes;
  - the "Open original" link is a toolbar button (a real `<a>` that follows the
    current slide's `src`); the library's own zoom in/out keys sit next to it;
  - imported `styles.css` and `plugins/counter.css`, plus a new
    `lightbox-theme.css` that maps the library's CSS variables onto the app
    tokens (page-coloured backdrop, near-white buttons/counter) so nothing is
    white.
- Kept the exported API (`MediaViewerProvider`, `useMediaViewer`,
  `MediaViewerTarget`, `OpenMediaViewer`) so `ImageMessage.tsx`,
  `message/AlbumGrid.tsx` and `routes/ChatView.tsx` are unchanged, and kept the
  album scoping (`MediaViewer.tsx:76-93` before, the same `photos` memo now).
- Kept the source rule: every slide URL goes through `mediaSrc` in
  `viewerSlides.ts` (same-origin `/upload/` → `GET /api/files`), so an untrusted
  URL is never fetched beyond what the viewer already did.
- Deleted `useZoomPan.ts`, `zoomGeometry.ts` and `ViewerArrows.tsx` (nothing
  else imported them). `MediaViewer.tsx` no longer imports `ui/use-modal.ts`, so
  that file is untouched (T-1344 owns it).
- File sizes: `MediaViewer.tsx` 126 lines, `viewerSlides.ts` 21,
  `lightbox-theme.css` 34 (limit 400). No tests (UI).

### Library check (spec asked for this)

```
npm view yet-another-react-lightbox version time.modified peerDependencies
version = '3.32.2'
time.modified = '2026-07-30T21:17:29.604Z'
peerDependencies = { '@types/react': '^16 || ^17 || ^18 || ^19',
  '@types/react-dom': '^16 || ^17 || ^18 || ^19',
  react: '^16.8.0 || ^17 || ^18 || ^19',
  'react-dom': '^16.8.0 || ^17 || ^18 || ^19' }
```

3.32.2 is the latest and was published over two weeks before today; the React
peer range includes this app's React 19.3, and it is a plain React/Vite package
(no native bits). Fits the web app.

### Files changed (all inside Allowed files)

- `apps/web/package.json` — added `"yet-another-react-lightbox": "3.32.2"`.
- `pnpm-lock.yaml` — the new package (install).
- `apps/web/src/components/media/MediaViewer.tsx` — rewritten on `<Lightbox>`.
- `apps/web/src/components/media/viewerSlides.ts` — new: `ViewerPhoto[]` → slides.
- `apps/web/src/components/media/lightbox-theme.css` — new: dark-kit variables.
- `apps/web/src/components/media/useZoomPan.ts` — deleted.
- `apps/web/src/components/media/zoomGeometry.ts` — deleted.
- `apps/web/src/components/media/ViewerArrows.tsx` — deleted.
- `work/T-1343-web-lightbox.md` — status + this Report.

### Commands run (real results)

- `npm view yet-another-react-lightbox version time.modified peerDependencies`:
  as quoted above.
- `pnpm install`: completed, added the package; the only warning is the
  pre-existing `@types/react-dom` peer warning for `@types/react`.
- While working, a targeted `pnpm --filter @zilar/web typecheck`: passed
  (`tsc` on both tsconfigs, no errors), and `pnpm exec oxlint
  apps/web/src/components/media`: no findings. (I ran these to iterate, then the
  gate once below, as AGENTS.md asks.)
- `pnpm gate` (from the repo root), final run:
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (0.7s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.9s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/web  (6.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Nearest tests: this is UI-only; the gate ran the web package's nearest tests
  (`PASS tests @zilar/web`) and I ran no test file directly.

### Problems / deviations / open questions

- No Download button: the old viewer never had one, and the spec keeps it only
  "if the current viewer has them". "Open original" is kept as the toolbar link.
- The Zoom plugin contributes its own zoom in/out toolbar keys; they are left in
  place next to "Open original" and Close. Say the word if you want them hidden
  (`render.buttonZoom`) or "Open original" moved out of the toolbar.
- I could not exercise the gestures here (UI gets no tests; I did not run the
  app). The lead's live check covers wheel/double-click/drag, the arrows +
  counter, and Escape. One thing worth watching there: the toolbar link reads
  the current slide through the library's `on.view`, so confirm the link follows
  the photo as you step.

### Round 1 (fix round, finding 1)

- **Fixed finding 1 (must-fix):** `MediaViewer.tsx` now passes the mirrored slide
  index to the library (`index={index}` instead of `index={startIndex}`), the
  documented "Tracking Slide Index" pattern, alongside the existing
  `on={{ view: ... setIndex }}`. Confirmed in the installed package
  (`yet-another-react-lightbox@3.32.2`, `dist/index.js`) that the reducer's
  `update` action sets `currentIndex: action.index` whenever the `slides` prop
  reference changes, so the old code snapped back to `startIndex` on an incoming
  message; the mirrored index keeps the current slide. The comment above
  `startIndex` was updated to match.
- **Nits 2 and 3 left alone:** they are on lines this round does not change
  (finding 2: focus trap/return, `MediaViewer.tsx:47-61`; finding 3: the
  "Open original" link lag, `:97,111-126`).
- **Tests added: none.** The fix is UI prop wiring, the spec says "No tests
  (UI)", AGENTS.md gives UI code no tests, and no test path is in this task's
  Allowed files.
- **Gate:** `pnpm gate` from the repo root passed (run after the fix):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.3s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.0s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/web  (3.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after 1 auto round (2 nits); the packet is current for `787f1770`.** The change is −632/+274 lines. The live check follows the deploy (the mock has no images).
