---
id: T-1007
title: "Size split T81: apps/web/src/components/AvatarUploader.tsx (514 lines) into components/avatar/{avatarImageCodec,avatarErrors,CropDialog}; one applyCrop"
status: merged
milestone: M5
branch: task/T-1007-split-web-avatar-uploader
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1007: Split `AvatarUploader.tsx`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/web/src/components/AvatarUploader.tsx` is 514 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #77 (task T81). The new files go in a new `apps/web/src/components/avatar/` folder: `avatarImageCodec.ts`, `avatarErrors.ts` and `CropDialog.tsx`. `AvatarUploader.tsx` keeps pick, save and remove, the section shell, and every export it has today.

The in-file Dedup is in scope: the three crop clamps (the `pick` reset, `onPointerMove` and the zoom change) become one `applyCrop(state)`, with the same bounds.

The lead checks it in Chrome in mock mode, on the Profile page's picture section.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #77, and `apps/web/src/components/AvatarUploader.tsx`.

### Allowed files
`apps/web/src/components/AvatarUploader.tsx`, `apps/web/src/components/avatar/avatarImageCodec.ts`, `apps/web/src/components/avatar/avatarErrors.ts`, `apps/web/src/components/avatar/CropDialog.tsx`, `work/T-1007-split-web-avatar-uploader.md`.

### Checks
```bash
pnpm --filter @zilar/web build
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Split `apps/web/src/components/AvatarUploader.tsx` (514 lines) into the files the
plan names, moving code unchanged. The component keeps pick, save, remove, the
section shell and both original exports; importers are untouched.

- `apps/web/src/components/avatar/avatarImageCodec.ts` — lines 34–159: `Phase`,
  `ImageSize`/`ImageLoader`/`Exporter`, `ImageUnreadable`, `loadImageSize`,
  `encodeAvatar`, the browser default loader/exporter, the preview-URL helpers
  (`previewUrlFor`/`revokePreviewUrl` + the synthetic-URL counter),
  `PickedCrop` and `exportAvatarFile`. Only the names the barrel/dialog import
  are exported.
- `apps/web/src/components/avatar/avatarErrors.ts` — lines 483–514:
  `friendlyUploadError`.
- `apps/web/src/components/avatar/CropDialog.tsx` — lines 316–347 (pointer
  handlers) and 407–478 (the `Dialog` JSX), plus the computed `fitted`/`zoomed`
  (356–360). It receives `crop`, `natural`, `objectUrl`, `busy`, `imageRef`,
  `onCropChange`, `onSave`, `onClose`; `dragRef` now lives here.
- `apps/web/src/components/AvatarUploader.tsx` (barrel/main) — imports the above
  and renders `<CropDialog>` in the crop phase.

Same code, only relocated. The pointer-handler `phase.name !== 'crop'` guards
became unnecessary (the dialog only exists in the crop phase) and the render
guard `phase.name === 'crop' && fitted !== null && zoomed !== null` became
`phase.name === 'crop'`; `fitInView` never returns null and `zoomed` is derived
from it, so both are non-null whenever the phase is crop. No behaviour change.

### Dedup (in scope)

One `applyCrop(source, state)` in `avatar/CropDialog.tsx` replaces the three crop
clamps: the `pick` reset (was line 245), `onPointerMove` (329–343) and the zoom
change (463–469). It returns `{ zoom: clampZoom(state.zoom), offsetX, offsetY }`
from `clampOffset(source, state)`, so the bounds are the same (`clampOffset`
still clamps the zoom internally, and the previous offset/zoom outputs were
already within range). `AvatarUploader.tsx` and `CropDialog.tsx` both call it.

### Sizes (`wc -l`)

| file | before | after |
| --- | --- | --- |
| `apps/web/src/components/AvatarUploader.tsx` | 514 | 259 |
| `apps/web/src/components/avatar/avatarImageCodec.ts` | — | 135 |
| `apps/web/src/components/avatar/avatarErrors.ts` | — | 33 |
| `apps/web/src/components/avatar/CropDialog.tsx` | — | 148 |

Every new file and the main stay under 400 lines. No extra split was needed.

### Export diff (`grep -E "^export"`)

Before (`git show main:apps/web/src/components/AvatarUploader.tsx`):

```
export type AvatarKind = 'user' | 'ai' | 'group';
export function AvatarUploader({
```

After (barrel + new files): the barrel still exports exactly those two, same
names and kinds; the new files add only internal exports the barrel/dialog import:
`Phase`, `ImageSize`, `ImageLoader`, `Exporter`, `ImageUnreadable`,
`defaultImageLoader`, `defaultExporter`, `previewUrlFor`, `revokePreviewUrl`,
`PickedCrop`, `exportAvatarFile` (codec), `friendlyUploadError` (errors),
`applyCrop`, `CropDialog` (dialog). No name the old file exported is missing.

### Importers

`AiPictureSection.tsx`, `ProfileSettingsSection.tsx` and `GroupPictureSection.tsx`
import `{ AvatarUploader }` from the same path; they did not change.

### Effect ratchet

No `// effect-plain:` marker was added (none needed). `avatarImageCodec.ts`
imports `effect` as a value → `effect`. `avatarErrors.ts` and `CropDialog.tsx`
carry no hard or weak signals → `plain`. The gate's `effect` step passed.

### Tests

No test file exists for `AvatarUploader` and no test was touched (rule 5). The
gate reported `SKIP tests @zilar/web (no nearby test files)`.

### Commands and real results

- `pnpm install` — done, 15 projects, no repo changes.
- `pnpm --filter @zilar/web build` — `✓ built in 1.17s` (chunk-size warning only).
- `pnpm gate` (1st) — `FAIL format` on `apps/web/src/components/avatar/CropDialog.tsx`
  (prettier), scope pass.
- `pnpm exec prettier --write apps/web/src/components/avatar/CropDialog.tsx` — one line
  collapsed, no logic change.
- `pnpm gate` (2nd) — summary:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (2.0s)
PASS  format  (1.6s)
PASS  lint  (2.1s)
PASS  typecheck  (6.9s)
PASS  effect  (1.2s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations

- `avatarImageCodec.ts` follows the plan range 34–159, which includes `Phase`;
  `Phase` therefore lives in the codec file and the main imports it as a type.
- `fitted`/`zoomed` (356–360) moved into `CropDialog.tsx` because only the dialog
  used them after the split.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `AvatarUploader.tsx` (514 lines) is now 259 lines, plus `components/avatar/{avatarImageCodec,avatarErrors,CropDialog}`. One `applyCrop` replaces the three clamps.
- **The lead checked it in Chrome on `/settings/profile?mock=1`:**
  - uploading a 1024×1024 PNG opens "Crop your picture" with the zoom slider and "exports 256 × 256";
  - after zooming in and dragging the image far right, the circle stays fully covered, so the clamp holds.
- **Save failed with "This request has no mock handler", plus Dismiss.** Avatar upload has no mock handler yet (mock wave 2, profile), so the save itself was not checked.
- **Check:** the gate passed, and so did the web build.
