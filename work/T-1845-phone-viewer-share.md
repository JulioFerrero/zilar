---
id: T-1845
title: "Phone photo viewer gets a Share key next to Save (audit MUX-13): download the shown photo to the cache and open the system share sheet with expo-sharing; same key style as Save, a fixed failure line"
status: merged
milestone: M5
branch: task/T-1845-phone-viewer-share
model: auto
effort: default
depends_on: []
estimate: 30 min
---

# T-1845: Share from the phone photo viewer

## Spec (written by Claude, do not edit)

### Why
**Audit MUX-13 is still `partly`** (`docs/audit/findings-sweep-client.md:33`): the viewer has Save and Close only, with no Share, and no share library is a dependency. Sharing a photo to another app is a basic messenger action (Telegram has it).

### Facts (read by the lead on 2026-10-17)
- **`apps/mobile/src/components/chat/image-viewer.tsx`** (259 lines):
  - the toolbar (`:227-245`) has a "Save photo" `Pressable` (`rounded-full bg-surface p-2`, `Download` 22 px white, disabled while saving or without a `source`) and a "Close viewer" one;
  - `onSave` (`:189-198`) calls `savePhoto(source, cb)`;
  - the outcome line comes from `SAVED_MESSAGE`/`SAVE_FAILED_MESSAGE` (`:200`).
- **`apps/mobile/src/lib/save-photo.ts`** (86 lines), the Effect `saveEffect` (`:43-77`):
  - it asks for gallery permission;
  - creates a cache `File` named by `cacheFileName(uri)`;
  - runs `File.downloadFileAsync(source.uri, destination, { idempotent: true, headers })`;
  - saves, then deletes the file with `deleteQuietly`.
- **Dependencies:** `apps/mobile/package.json` has `expo` `~57.0.25` and `expo-file-system` `~57.0.7`, and no `expo-sharing`.

### Steps
1. **Add `expo-sharing`** with `pnpm --filter @zilar/mobile exec expo install expo-sharing`, so the version matches Expo 57. The lockfile updates.
2. **New `apps/mobile/src/lib/share-photo.ts`:**
   - It downloads the photo to the cache the same way as `save-photo.ts`. Export `cacheFileName` and `deleteQuietly` from `save-photo.ts` if needed rather than copying them.
   - Then it calls `Sharing.shareAsync(file.uri, { mimeType })`, with the type guessed from the extension and defaulting to `image/jpeg`.
   - It deletes the cache file afterwards.
   - **Failure handling:** if `Sharing.isAvailableAsync()` is false, or anything fails, it reports one fixed sentence `SHARE_FAILED_MESSAGE = 'Could not share the photo.'`. A user cancelling the sheet is not a failure.
   - **No gallery permission** is needed for sharing.
3. **`image-viewer.tsx`:** add a "Share photo" `Pressable` between Save and Close, with the same classes and a lucide `Share2` (22 px, white). Disable it while a share runs or without a `source`. Show the failure line the way Save's is shown.
4. **No tests** (UI). Every file stays at most 400 lines.

### Allowed files
- `apps/mobile/package.json`
- `pnpm-lock.yaml`
- `apps/mobile/src/lib/share-photo.ts`
- `apps/mobile/src/lib/save-photo.ts`
- `apps/mobile/src/components/chat/image-viewer.tsx`
- `work/T-1845-phone-viewer-share.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **In a native build,** the viewer shows Save, Share and Close. Share opens the Android share sheet with the photo, and a failure shows "Could not share the photo."
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- Added `expo-sharing` (`~57.0.23`, the Expo 57-matched version) to `apps/mobile/package.json` with `pnpm --filter @zilar/mobile exec expo install expo-sharing`; `pnpm-lock.yaml` updated. The command exits 1 after installing because it cannot auto-add the package's config plugin to the dynamic `apps/mobile/app.config.ts`. That plugin only sets up an iOS share *extension* (receiving shares); `shareAsync` needs no plugin, and `app.config.ts` is outside my Allowed files, so I left it untouched.
- New `apps/mobile/src/lib/share-photo.ts` (81 lines): mirrors `save-photo.ts`'s Effect seam. It checks `Sharing.isAvailableAsync()` first, downloads the `MediaSource` (same bearer, same URL) to a cache `File` named by `cacheFileName`, calls `Sharing.shareAsync(file.uri, { mimeType })` with the MIME type taken from the extension (`.jpg`/`.jpeg`/`.png`/`.webp`/`.gif`, default `image/jpeg`), and deletes the cache file with `deleteQuietly`. It asks for no gallery permission. Every failure — unavailable sharing, bad cache file, failed download, rejected platform call — collapses to the fixed `SHARE_FAILED_MESSAGE = 'Could not share the photo.'`. A dismissed sheet resolves and counts as shared.
- `apps/mobile/src/lib/save-photo.ts`: exported `cacheFileName` and `deleteQuietly` (no behaviour change), so the share seam reuses them instead of copying.
- `apps/mobile/src/components/chat/image-viewer.tsx` (294 lines): a "Share photo" `Pressable` between Save and Close, same classes, lucide `Share2` at 22 px white, disabled while `source` is undefined or a share runs. It has its own `{ index, state }` like Save's, so the line follows the photo on screen. Starting a save clears a share line and vice versa; a share error shows `SHARE_FAILED_MESSAGE` on the same line Save uses. Updated the component doc comment.

### Checks run

- `pnpm install`: done, success (only the pre-existing `@types/react` peer warning).
- `pnpm --filter @zilar/mobile exec expo install expo-sharing`: installed `expo-sharing ~57.0.23`; exited 1 on the config-plugin write (see above), dependency and lockfile are correct.
- `pnpm gate` (first run): FAIL on `format` (`apps/mobile/src/lib/share-photo.ts` not Prettier-formatted); fixed with `pnpm exec prettier --write` on that one file.
- `pnpm gate` (final run):
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (0.5s)
  PASS  lint  (1.4s)
  PASS  typecheck  (4.0s)
  PASS  effect  (1.9s)
  PASS  tests @zilar/mobile  (2.8s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the spec says no tests (UI), and the gate ran the `@zilar/mobile` suite.

### Notes for the lead

- The `expo install` non-zero exit is only the dynamic-config plugin warning described above; the dependency resolves and the gate is green. If you want the iOS *receive* share extension later, that plugin entry needs a separate task, since `app.config.ts` is out of scope here.
- I did not test on a device; acceptance ("share sheet opens, failure shows the fixed line") still needs the phone smoke.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `ed6dbd1ec`.
- **Read the code:**
  - `sharePhoto` downloads the photo the viewer shows (with its bearer) to the cache, calls `Sharing.shareAsync`, deletes the file, and collapses every failure into "Could not share the photo.";
  - the key sits between Save and Close in the same style;
  - `expo-sharing ~57.0.23` was added with `expo install`.
- **The branch's native mock build installed and ran** (smoke PASS).
- **Not verified on a device:** mock photos are placeholders that don't load, so the viewer can't open in mock mode, and the lead doesn't sign in to live on the emulator. Check the share sheet in the next phone build.
- **Nits left:** the MIME type is read from the raw URI, and a failed download leaves its partial cache file, the same as Save.

