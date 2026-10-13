---
id: T-1320
title: "Mobile attach sheet like Telegram: a bottom sheet with the recent photos grid inline (camera tile first, round select circles, multi-select, Send N), and a bottom tab bar Gallery | File; the File tab offers Browse files and 'Send photos as files'"
status: merged
milestone: M5
branch: task/T-1320-mobile-attach-sheet-telegram
model: auto
effort: default
depends_on: []
estimate: 0.6 day
---

# T-1320: Telegram-style attach sheet (mobile)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13, with Telegram screenshots: the attach flow should be "like Telegram". Telegram's paperclip opens a bottom sheet with:
- **The Gallery tab (default):** a grid of the phone's recent photos and videos, 3 per row. The first tile is a live camera tile. Every tile has a round select circle at the top right, and a video shows its duration. Picking one or more shows a send bar ("Send N", with an optional caption).
- **A bottom tab bar:** Gallery | File | Location | Poll | Contact. **Zilar needs only Gallery and File.**
- **The File tab:** "Internal Storage: browse your file system", "Gallery: send images without compression", and a "Recent files" list.

Zilar today (`apps/mobile/src/components/chat/attach-sheet.tsx`, 162 lines) is a list with three rows: Photo or video, Take a photo, File. Each opens a system picker. Picked files are staged in the composer's strip (T-1246) and sent from there (`apps/mobile/src/components/chat/composer.tsx`, 291 lines; `composer-picked-strip.tsx`).

### What to build
1. **Gallery tab:**
   - read the recent assets with `expo-media-library` (already installed and configured, `apps/mobile/app.json:57,68`; also used in `apps/mobile/src/lib/save-photo.ts`), asking for permission the first time;
   - a 3-column grid of thumbnails, paged as the user scrolls (about 60 per page);
   - the first tile is a camera tile that runs today's "Take a photo";
   - tapping a tile toggles its round select circle (numbered in pick order, like Telegram); a video tile shows its duration;
   - with at least one selected, a bar shows "Send N", which stages them into the composer strip through the same path as today's library pick (cite it), so albums (T-1250-era) and captions keep working;
   - permission denied: a short text plus a button "Open settings" / "Choose from gallery" (today's picker).
2. **File tab:** the rows "Browse files" (today's document picker) and "Send photos as files" (the library picker, staged as `kind: 'file'` if the existing path supports it; cite it, otherwise leave this row out and say so). Skip "Recent files".
3. **Bottom tab bar** inside the sheet: Gallery | File, with lucide icons (Image, File) and the active pill like the app's main tab bar. No emoji.
4. **Mock mode** keeps the demo attachments (`demoAttachments`, `onPickDemo`) working; show them in the Gallery tab when the media library isn't available.
5. Split into components under `apps/mobile/src/components/chat/attach/`; every file stays at most 400 lines. **No tests** (UI).

### Read first
`AGENTS.md`, `apps/mobile/src/components/chat/attach-sheet.tsx`, `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/composer-picked-strip.tsx`, where `onPick` is handled (cite it), and `apps/mobile/src/lib/save-photo.ts`.

### Allowed files
`apps/mobile/src/components/chat/attach-sheet.tsx`, `apps/mobile/src/components/chat/attach/**/*.tsx`, `apps/mobile/src/components/chat/attach/**/*.ts`, `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/composer-picked-strip.tsx`, `apps/mobile/src/components/chat/composer-media.ts`, `apps/mobile/src/lib/attachments.ts`, `apps/mobile/src/lib/attachment-picker.ts`, `apps/mobile/src/lib/attachment-native.ts`, `apps/mobile/app.json`, `work/T-1320-mobile-attach-sheet-telegram.md`. (Lead, 2026-10-13: `app.json` was added for the permission fix.) (The pickers are in `apps/mobile/src/lib/attachment-picker.ts`, 234 lines, wired through `attachment-native.ts` and `composer-media.ts`.)

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/attachments.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator** (release build): the paperclip opens the grid with the camera tile; picking two photos shows "Send 2", and sending stages them; the File tab opens the document picker.

---

## Report (written by the worker when done)

### What I did

Rebuilt the paperclip sheet as a Telegram-style bottom sheet (T-1320):

- **Shell** (`attach-sheet.tsx`): a bottom sheet 75 % tall with the header, the
  global busy/error lines, the tab body and the bottom tab bar. The open sheet
  lives in `AttachSheetBody`, split out so closing unmounts it and clears the
  tab, the loaded page and the selection (the `open` early return cannot run
  hooks).
- **Gallery tab** (`attach/gallery-tab.tsx` + `attach/gallery-grid.tsx` +
  `attach/use-gallery-assets.ts`): a 3-column grid of the phone's recent photos
  and videos from `expo-media-library`, ~60 per page, paged on scroll; the first
  tile is a live camera tile that runs today's `onPick('camera')`. A video shows
  its duration. Tapping a tile toggles a round select circle numbered in pick
  order; with ≥1 selected a "Send N" bar stages the files into the composer
  strip. A first-time permission prompt runs on open; denied shows a fixed
  sentence plus **Open settings** (`Linking.openSettings`) and **Choose from
  gallery** (today's library picker). Mock/unavailable shows the demo
  attachments.
- **Staging path**: `stageAssets` (in the hook) resolves each selected asset to
  a `PickedFile` — `getAssetInfoAsync` gives the uploadable `file://` URI (the
  `ph://` display URI is only for the `expo-image` thumbnails), then the shared
  size reader and photo downscaler (`createSizeReader` /
  `createImageDownscaler`) run exactly like the library picker — and the new
  `composer-media.stageFiles` puts them into the composer strip with the same
  `setPicks(files)` + close the picker path uses (`composer-media.ts`), so
  albums (T-1246) and captions keep working (`sendPicked` reads the same
  `picks`).
- **File tab** (`attach/file-tab.tsx`): "Browse files" runs today's document
  picker. "Recent files" skipped.
- **Bottom tab bar** (`attach/attach-tab-bar.tsx`): Gallery | File, lucide
  `Image` / `File`, the active `segment` pill of the main floating tab bar; the
  gradient-carrying face is keyed by its look (the gradient-swap pitfall).

### Files changed

- `apps/mobile/src/components/chat/attach-sheet.tsx` (rewritten as shell)
- `apps/mobile/src/components/chat/attach/attach-tab-bar.tsx` (new)
- `apps/mobile/src/components/chat/attach/file-tab.tsx` (new)
- `apps/mobile/src/components/chat/attach/gallery-grid.tsx` (new)
- `apps/mobile/src/components/chat/attach/gallery-tab.tsx` (new)
- `apps/mobile/src/components/chat/attach/use-gallery-assets.ts` (new)
- `apps/mobile/src/components/chat/composer-media.ts` (added `stageFiles`)
- `apps/mobile/src/components/chat/composer.tsx` (pass `onStageFiles`)
- `apps/mobile/src/lib/attachment-picker.ts` (added `createGalleryReader` + types)
- `apps/mobile/src/lib/attachment-native.ts` (barrel exports)
- `apps/mobile/src/lib/attachments.ts` (added `mimeForFileName`)
- `work/T-1320-mobile-attach-sheet-telegram.md`

### Commands and results

- `pnpm install`: done, `Done in 14.1s` (one pre-existing peer warning:
  `@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18).
- `pnpm --filter @zilar/mobile exec vitest run src/lib/attachments.test.ts
  --reporter=dot`: **1 file passed, 4 tests passed**.
- `pnpm gate` (from the repo root), summary lines:

```
gate: 12 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (1.8s)
PASS  lint  (2.5s)
PASS  typecheck  (6.1s)
PASS  effect  (3.1s)
PASS  tests @zilar/mobile  (4.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

The first gate runs flagged a Prettier issue and then an Effect-ratchet issue in
the two new files; I fixed both (Prettier `--write`, and the async work now goes
through `effect` in `use-gallery-assets.ts` / `gallery-tab.tsx`) and re-ran the
gate to green.

### Deviations from the spec

- **"Send photos as files" row omitted** (spec item 2 allows this): the send path
  takes `kind` from the file's MIME, not from the caller — `classifyMobileFile`
  in `apps/mobile/src/lib/attachments.ts` feeds `attachmentDataFor`, and the
  store's `bytesFor.describe` (`apps/mobile/src/store/effects/ports.ts`, not an
  Allowed file) is what decides `kind`. A photo therefore cannot be forced to
  `kind: 'file'` without editing that store port, so the row is left out.
- **Mock mode** keeps `demoAttachments`/`onPickDemo` as rows inside the Gallery
  tab (shown only when the library is not ready); multi-select + "Send N" is the
  real-library path. The demo tiles were not given selection circles.
- No tests added (UI), per spec §What to build item 5.
- I did not run an emulator/release build: the acceptance emulator check is the
  lead's.

### Open questions

- None blocking. See the "Send photos as files" note above if that row is wanted
  in a follow-up (it needs the store's bytes port to accept a `kind` override).

### Round (fix round, 2026-10-13)

- **Finding 1 (should-fix, `attachment-picker.ts`) fixed.** The Gallery tab's
  `toPickedFile` now applies the same size guards as the library pick, so an
  empty or over-cap asset is refused with the same fixed sentence instead of
  being staged and uploaded. Extracted `sizeErrorMessage` (real zero →
  `EMPTY_MESSAGE`, over 50 MB → `TOO_LARGE_MESSAGE`) and used it in both
  `pickedFile` and `createGalleryReader.toPickedFile`. The reader now returns
  `GalleryPickResult` (`{ status: 'picked'; file }` | `{ status: 'error'; message }`),
  `useGalleryAssets.stageAssets` folds the per-asset results (all-or-nothing,
  first error wins) and `GalleryTab` shows that sentence in its existing alert
  line without staging.
- **Test added:** `apps/mobile/src/components/chat/attach/gallery-reader.test.ts`
  (3 tests: zero-byte refused with `EMPTY_MESSAGE`, over-cap refused with
  `TOO_LARGE_MESSAGE`, normal asset staged with its size and the downscaled
  file). Ran
  `pnpm --filter @zilar/mobile exec vitest run src/components/chat/attach/gallery-reader.test.ts --maxWorkers=2 --reporter=dot`:
  **1 file passed, 3 tests passed**. Also ran the Spec's check
  `pnpm --filter @zilar/mobile exec vitest run src/lib/attachments.test.ts --reporter=dot`:
  **1 file passed, 4 tests passed**.
- **Nits left alone** (not in lines this round changed): `gallery-grid.tsx:104`
  (toggle ignores `busy`) and `attach-sheet.tsx:61` (`useGalleryAssets` mounts on
  every sheet open).
- `pnpm gate` (from the repo root), summary lines:

```
gate: 13 changed file(s) against main
PASS  install (frozen)  (2.2s)
PASS  format  (2.0s)
PASS  lint  (1.3s)
PASS  typecheck  (5.5s)
PASS  effect  (1.8s)
PASS  tests @zilar/mobile  (4.4s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

The first gate run failed the format step on the four edited/new files; Prettier
`--write` fixed the style and the re-run is the green one above.

### Disagreements

- None.

### Round 2 (permission fix, 2026-10-13 10:15)

The lead's emulator check found the Gallery tab asking for music/audio access (a
second OS prompt) before the photos prompt, unlike Telegram.

- **Fix:** `createGalleryReader.requestPermission` now asks for granular read
  permissions only — `MediaLibrary.requestPermissionsAsync(false, ['photo', 'video'])`.
  The installed `expo-media-library` 57 signature is
  `requestPermissionsAsync(writeOnly?: boolean, granularPermissions?: GranularPermission[])`
  with `GranularPermission = 'audio' | 'photo' | 'video'`
  (`node_modules/expo-media-library/src/legacy/MediaLibrary.ts:33,465`); cited in
  `attachment-picker.ts`. No `MediaLibrary.getPermissionsAsync` check exists to
  change (the only other media-library call is `save-photo.ts`'s write-only
  `requestPermissionsAsync(true)`, outside this task's files and not a read prompt).
- `apps/mobile/app.json`: the `expo-media-library` plugin now sets
  `"granularPermissions": ["photo", "video"]` (kept `savePhotosPermission`), so the
  Android manifest no longer declares `READ_MEDIA_AUDIO`.
- **Test:** added one to `gallery-reader.test.ts` asserting `requestPermissionsAsync`
  is called with `(false, ['photo', 'video'])`.
- `attachment-picker.ts` is 357 lines (≤ 400).
- **Commands:** `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json`:
  **0 errors**; `... vitest run src/components/chat/attach/gallery-reader.test.ts
  --maxWorkers=2 --reporter=dot`: **1 file passed, 4 tests passed**; `pnpm gate`:
  GATE PASS.

```
gate: 14 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (1.2s)
PASS  lint  (0.6s)
PASS  typecheck  (2.8s)
PASS  effect  (0.6s)
PASS  tests @zilar/mobile  (1.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

Note: the first `tsc` run reported a pre-existing T-1319 error — `Cannot find
module 'expo-intent-launcher'` in `attachment-opener.ts`, a dependency that was
locked but not yet linked in this worktree. `pnpm install --frozen-lockfile`
linked it and the re-run was clean (0 errors).

## Review (written by Claude)

**Lead, 2026-10-13: approved after 1 lead fix round and 1 auto round.**
- **Lead's check on the emulator** (release mock build, Android 15):
  - the paperclip opens the Gallery grid with the Camera tile first;
  - tapping a photo shows a numbered circle "1" and "Send 1", and Send stages it in the composer strip ("s.png, 21 KB");
  - the bottom tabs are Gallery | File.
- **Lead fix round:** the first prompt asked for "music and audio". Now it requests `['photo','video']` only (`attachment-picker.ts:298`) and the plugin sets `granularPermissions: ["photo","video"]`. Rechecked after revoking: only the photos and videos prompt shows, and the manifest has no `READ_MEDIA_AUDIO`.
- **Lead's checks:** mobile tsc: 0 errors; attachments + attach tests: 8 pass; the largest file is 357 lines.
