---
id: T-1256
title: "TG-6 mobile: the full-screen photo viewer swipes left/right between the chat's photos (same list rule as web's photosOf) with a 3 / 12 counter, and a Save button stores the photo in the phone's gallery (expo-media-library, bytes through GET /api/files with the bearer)"
status: merged
milestone: M5
branch: task/T-1256-mobile-photo-viewer-swipe-save
model: auto
effort: default
depends_on: [T-1232]
estimate: 0.5 day
---

# T-1256: Swipe between photos and save a photo (mobile)

## Spec (written by Claude, do not edit)

### Why
This is the mobile half of TG-6.
- **The web viewer** (T-1232, `apps/web/src/components/media/MediaViewer.tsx`) steps through the chat's photos with ←/→. Its list rule is `photosOf` (`:50-64`): `message.image` and `attachment.kind === 'image'` only, never a file, so a photo on an untrusted host is never loaded (the comment at `:44-49` explains why).
- **The mobile viewer** `AttachmentViewer` (`apps/mobile/src/components/chat/image-viewer.tsx`, 193 lines, props at `:34-41`, component at `:124`) shows one photo. It's opened per bubble from `apps/mobile/src/components/chat/attachment-body.tsx:139-145`.
- **No save:** there is no way to save a photo. `expo-media-library` isn't installed (`apps/mobile/package.json`; `expo` is `~57.0.25`).

### What to build
1. **The shared photo list:** move `photosOf` and its `ViewerPhoto` type (`MediaViewer.tsx:36`) into `packages/chat-core/src/photos.ts` (export it, and keep its doc comment), and make the web import it. No behaviour change on the web.
2. **Swipe:** `AttachmentViewer` takes `photos: ViewerPhoto[]` and a start index instead of one `url`.
   - A horizontal swipe at scale 1 moves to the next or previous photo, and zoom resets on change. Today's pinch, pan and swipe-down-to-close keep working (`image-viewer.tsx` gestures).
   - Show a "3 / 12" counter at the top.
   - The caller (`attachment-body.tsx`) passes the chat's photos from the store (`messagesByChat`, `apps/mobile/src/store/types.ts:70`) through `photosOf`, and the index of this message. Each photo URL still goes through `viewableUrl` and `useMediaSource` exactly as today (trusted hosts and the bearer); never load an untrusted host.
   - Keep every file at most 400 lines: put the pager in a new `apps/mobile/src/components/chat/photo-pager.tsx` if needed.
3. **Save:**
   - add `expo-media-library` with `pnpm --filter @zilar/mobile exec expo install expo-media-library`, plus its config plugin in `apps/mobile/app.json` `plugins` (`:44`) with a short Android/iOS permission text: "Zilar saves photos you choose to your gallery.";
   - a Save icon button (lucide `Download`) in the viewer's top bar:
     - download the current photo to the cache with `expo-file-system`, using the same URL and bearer headers as the displayed source;
     - then call `MediaLibrary.saveToLibraryAsync` after asking for permission (write only);
     - success shows "Saved to gallery" and failure shows "Could not save the photo." as a short in-viewer line (no `Alert.alert`);
     - delete the cache file afterwards.
4. **No tests** (UI).

### Read first
`AGENTS.md`, `work/T-1232-web-media-viewer.md`, `apps/web/src/components/media/MediaViewer.tsx`, `apps/mobile/src/components/chat/image-viewer.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/lib/media-source.ts` and `apps/mobile/app.json`.

### Allowed files
`packages/chat-core/src/photos.ts`, `packages/chat-core/src/index.ts`, `apps/web/src/components/media/MediaViewer.tsx`, `apps/mobile/src/components/chat/image-viewer.tsx`, `apps/mobile/src/components/chat/photo-pager.tsx`, `apps/mobile/src/components/chat/attachment-body.tsx`, `apps/mobile/src/lib/save-photo.ts`, `apps/mobile/package.json`, `apps/mobile/app.json`, `pnpm-lock.yaml`, `work/T-1256-mobile-photo-viewer-swipe-save.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every touched file stays at most 400 lines.
- **The lead's check:** on the next APK with real photos, swipe between two photos and Save one. Mock photos are blank tiles, so the mock can only show the counter.

---

## Report (written by the worker when done)

### What I did

TG-6 mobile, as specced.

1. **Shared photo list.** Moved `photosOf` and its `ViewerPhoto` type into
   `packages/chat-core/src/photos.ts` (doc comment kept verbatim), exported it
   from `packages/chat-core/src/index.ts`, and made web's `MediaViewer.tsx`
   import it. No behaviour change on the web.
2. **Swipe.** `AttachmentViewer` (`apps/mobile/src/components/chat/image-viewer.tsx`)
   now takes `photos: ViewerPhoto[]`, `startIndex`, and `trustedHosts`, and shows
   a "3 / 12" counter in the top bar. The gestures moved to a new
   `apps/mobile/src/components/chat/photo-pager.tsx`: at scale 1 the first
   movement picks an axis — a horizontal drag steps to the next/previous photo,
   a vertical drag still dismisses (unchanged). Pinch, pan-while-zoomed and
   double-tap are unchanged. `PhotoPager` is keyed by index, so zoom resets on
   every photo change. `attachment-body.tsx` reads `messagesByChat[chatId]`,
   passes it through `photosOf`, and passes the index of this message. Each
   photo's URL is gated by `viewableUrl` (trusted hosts and http(s) only) before
   `useMediaSource`: a photo off the trusted hosts (a mock `gradient:` tile, a
   `data:` URL) is rendered as a blank tile and never fetched.
3. **Save.** Added `expo-media-library@~57.0.5` with
   `pnpm --filter @zilar/mobile exec expo install expo-media-library`, and its
   config plugin in `apps/mobile/app.json` with
   `"savePhotosPermission": "Zilar saves photos you choose to your gallery."`.
   The new `apps/mobile/src/lib/save-photo.ts` downloads the exact `MediaSource`
   the viewer shows (same URL and bearer) to the cache with
   `expo-file-system`, asks `MediaLibrary.requestPermissionsAsync(true)`
   (write-only), calls `MediaLibrary.saveToLibraryAsync`, then deletes the cache
   file. The Save button (lucide `Download`) sits in the the top bar; success
   shows "Saved to gallery", failure shows "Could not save the photo." as a
   short in-viewer line (no `Alert.alert`). The line is tied to the index it was
   started on, so stepping to another photo hides it without an effect.
4. **No tests** (UI), as the spec says.

### Files changed

- `packages/chat-core/src/photos.ts` (new): `ViewerPhoto` + `photosOf`.
- `packages/chat-core/src/index.ts`: export `./photos`.
- `apps/web/src/components/media/MediaViewer.tsx`: imports `photosOf`; ~31 lines removed.
- `apps/mobile/src/components/chat/image-viewer.tsx`: list + counter + Save; gestures moved out.
- `apps/mobile/src/components/chat/photo-pager.tsx` (new): the zoom/swipe surface.
- `apps/mobile/src/components/chat/attachment-body.tsx`: builds the photo list and opens the viewer.
- `apps/mobile/src/lib/save-photo.ts` (new): the save seam.
- `apps/mobile/package.json`, `pnpm-lock.yaml`: `expo-media-library`.
- `apps/mobile/app.json`: the media-library plugin and its permission text.

`wc -l`: photos.ts 32, MediaViewer.tsx 162, image-viewer.tsx 142, photo-pager.tsx 209,
attachment-body.tsx 208, save-photo.ts 85 — all ≤ 400.

### Commands I ran

- `pnpm install`: done, 1180 packages, no error (the pre-existing `@types/react-dom` peer warning remains).
- `pnpm --filter @zilar/mobile exec expo install expo-media-library`: added `expo-media-library ~57.0.5`.
- `pnpm exec prettier --write <my 8 source files>`: only `photo-pager.tsx` needed reformatting.
- `pnpm gate` (from the repo root), real output:

  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.7s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/chat-core  (1.1s)
  PASS  tests @zilar/mobile  (1.2s)
  PASS  tests @zilar/web  (3.7s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

  The two runs before it failed and were fixed, not skipped: the first on
  `lint` (`react(set-state-in-effect)` in `image-viewer.tsx` — removed the
  effect and derive the save line from the index), the second on `effect`
  (`image-viewer.tsx` gained an H1 `.then(` signal — the async boundary now
  lives behind the `savePhoto(source, onResult)` callback seam in
  `save-photo.ts`).
- No single test files were run: the spec says no tests (UI); the gate selected
  the nearby chat-core/mobile/web tests itself.

### Notes / deviations

- **`expo-media-library/legacy`:** in SDK 57 the top-level
  `MediaLibrary.saveToLibraryAsync` is deprecated and throws at runtime (see
  `expo-media-library/build/legacyWarnings.d.ts`); the spec names that function,
  so `save-photo.ts` imports it from `expo-media-library/legacy`, where it is
  implemented. `requestPermissionsAsync(true)` (write-only) comes from the same
  module.
- **Mock:** the mobile mock's photos (`apps/mobile/src/mock/attachments.ts`) are
  `gradient:` placeholders of `kind: 'image'`, so they render as tappable
  gradient tiles; opening one shows a blank tile with the "1 / 2" counter and a
  disabled Save (the URL is not http(s), so it is never fetched). So the mock can
  show the counter but not a real Save; that is the lead's APK check.
- **`trustedHosts` prop:** the spec did not name it, but the per-photo
  `viewableUrl` gate needs the store's trusted hosts; I pass the same `hosts`
  the bubble already uses rather than reading the store a second time.

### Open questions

None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean (1 nit).**
- **The change:**
  - `photosOf` and `ViewerPhoto` moved to `@zilar/chat-core` `photos.ts` (the web imports them, no behaviour change);
  - the mobile viewer pages through the chat's photos (`photo-pager.tsx` 209 lines; `image-viewer.tsx` went from 193 to 144);
  - `save-photo.ts` asks for write-only gallery permission (`requestPermissionsAsync(true)`), downloads with the **same** `MediaSource` the viewer shows, so the bearer only goes to our API origin, saves with `saveToLibraryAsync`, and deletes the cache file;
  - `expo-media-library ~57.0.5` and its config plugin, with the permission text from the spec.
- **Lead's emulator check:** the mock build with the new native module installs and launches (SMOKE PASS, and logcat shows no native-module or fatal errors). Swipe and Save can't run in mock mode, because mock photos render as file cards.
- **Check on the next APK** with real photos: swiping between two photos, the counter, and Save to gallery.
