---
id: T-1346
title: "Web avatar cropper on react-easy-crop: replace CropDialog's hand-rolled drag/zoom/clamp maths with the library's round Cropper (drag, wheel and pinch zoom), keeping the 256x256 export"
status: merged
milestone: M5
branch: task/T-1346-web-easy-crop
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-1346: Web cropper on react-easy-crop

## Spec (written by Claude, do not edit)

### Why
The library audit (T-1342, row 9). `apps/web/src/components/avatar/CropDialog.tsx` (146 lines) and `apps/web/src/lib/avatar-crop.ts` (116) hand-roll the drag under a circular mask, a zoom slider and the clamping maths (`fitInView` `:35`, `clampZoom` `:51`, `clampOffset` `:63`, `cropRectFor` `:88`). There's no pinch or wheel zoom.

### Library rule (Julio, 2026-10-13)
Use the named library; do **not** hand-roll its behaviour. First check it with `npm view <pkg> version time.modified peerDependencies` and confirm it fits React 19 / Vite. Pin an exact version at least two weeks old. If it does not fit, set `status: blocked` and report. Every file stays at most 400 lines. **No tests** (UI). The plan is `docs/audit/library-plan.md` (T-1342).

### What to build
1. **Add `react-easy-crop`** (audit: 6.2.4, 2026-10-06) to `apps/web/package.json`.
2. **`CropDialog.tsx`:** use `<Cropper cropShape="round" aspect={1} showGrid={false}>` with drag, wheel and pinch zoom, and keep the zoom slider.
   - Keep `CropDialogProps` (`:19`) and what it hands back to `apps/web/src/components/AvatarUploader.tsx`, so the uploader changes only if it must.
   - The export stays 256 × 256 (`AVATAR_EXPORT_SIDE`), drawn from the library's `croppedAreaPixels`.
3. **`avatar-crop.ts`:** delete the maths the library now owns and keep only what the export needs.

### Read first
`AGENTS.md`, `apps/web/src/components/avatar/CropDialog.tsx`, `apps/web/src/lib/avatar-crop.ts`, `apps/web/src/components/AvatarUploader.tsx`.

### Allowed files
`apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/components/avatar/CropDialog.tsx`, `apps/web/src/lib/avatar-crop.ts`, `apps/web/src/components/AvatarUploader.tsx`, `work/T-1346-web-easy-crop.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's web mock check:** Settings → Change photo → the crop dialog drags, zooms with the wheel, and saves.

---

## Report (written by the worker when done)

### What I did
- Added `react-easy-crop` to `apps/web` and rewrote `CropDialog` on the library's
  `<Cropper cropShape="round" aspect={1} showGrid={false}>` (drag, wheel zoom via
  `zoomWithScroll`, pinch zoom on touch, `minZoom`/`maxZoom` 1–4). The zoom slider stays.
- `avatar-crop.ts` now holds only what the export needs: the export constants, the
  `CropState`/`CropArea` types and `exportDrawArgs`, which maps the Cropper's
  `croppedAreaPixels` to the 256 × 256 `drawImage` args (the drag/zoom/clamp maths is gone).
- `CropDialog` reports the Cropper's position, zoom and pixel area back through the
  existing `onCropChange` setter; `onCropComplete` bails out when the area is unchanged, so
  no render loop. The Cropper's own `<img>` is wired into the existing `imageRef` via the
  library's `setImageRef`, so the uploader's `onSave` still reads it and the export path is
  unchanged.

### Files changed
- `apps/web/package.json` — `react-easy-crop` `6.2.3` (exact).
- `pnpm-lock.yaml`.
- `apps/web/src/components/avatar/CropDialog.tsx` — Cropper-based dialog.
- `apps/web/src/lib/avatar-crop.ts` — library-agnostic export helpers only.
- `apps/web/src/components/AvatarUploader.tsx` — seeds `INITIAL_CROP_STATE`; drops the
  now-unused `natural` prop it passed to `CropDialog`.
- `work/T-1346-web-easy-crop.md`.

### Commands and results
- `npm view react-easy-crop version time.modified peerDependencies`: latest `6.2.4`
  (modified `2026-10-06T06:35:05Z`), peer `react >=16.4.0` / `react-dom >=16.4.0`; `6.2.3`
  was published `2026-07-24`.
- `pnpm install`: done (baseline).
- `pnpm --filter @zilar/web add react-easy-crop@6.2.3 --save-exact`: done.
- `pnpm gate`: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
  `PASS effect`, `SKIP tests @zilar/web (no nearby test files)`,
  `scope: every changed file is inside the Allowed files`,
  `migration: every added migration continues from the base`, `GATE PASS`.

### Deviations from the spec
- **Version `6.2.3`, not the audit's `6.2.4`.** The library rule requires an exact version
  at least two weeks old; `6.2.4` is 7 days old (2026-10-06), so I pinned the previous
  release `6.2.3` (2026-07-24). It fits React 19 / Vite (peer `react >=16.4.0`). If the
  lead prefers `6.2.4` despite the rule, it is a one-line change.
- **`CropDialogProps` lost `natural`.** The Cropper loads the image itself, so `natural`
  became unused; I removed it (one line in `AvatarUploader`) instead of keeping a dead
  prop. The rest of the interface and what it hands back are unchanged.

### Not done / not tested
- I did not run the lead's live web mock check (Settings → Change photo); no browser/dev
  server was started (safety rule). That check is the lead's.

### Open questions
- None blocking.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (2 nits); the packet is current for `f03fbbca`.**
Lead's headless web mock check, Settings → Profile → file input:
- "Crop your picture" opens on react-easy-crop with a round mask;
- the wheel zooms the image to scale 2.5, and a drag moves it (translate 60/30);
- "Save picture" closes the dialog.
