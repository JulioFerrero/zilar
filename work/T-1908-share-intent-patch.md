---
id: T-1908
title: "Share into Zilar: pnpm patch for expo-share-intent 8.0.1 (Android) so a share never crashes the app — getFileInfo stops using !! / an unchecked cursor, media probing can't throw, each file is guarded, and Files-app shares are copied into the app cache like every other content:// share"
status: merged
milestone: M5
branch: task/T-1908-share-intent-patch
model: auto
effort: default
depends_on: [T-1895]
estimate: 35 min
---

# T-1908: A share never crashes Zilar

## Spec (written by Claude, do not edit)

### Why
**The lead's emulator check of T-1895 (2026-10-17):** sharing an image whose `content://` uri returned an empty cursor **crashed the whole app**:
```
CursorIndexOutOfBoundsException: Index 0 requested, with a size of 0
  at expo.modules.shareintent.ExpoShareIntentModule$Companion.getFileInfo(ExpoShareIntentModule.kt:71)
  at ...handleShareIntent(ExpoShareIntentModule.kt:145)
```
8.0.1 is the latest release (`npm view expo-share-intent versions`), so we patch it.

### Facts (read by the lead in `node_modules/.pnpm/expo-share-intent@8.0.1_*/node_modules/expo-share-intent/android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt`)
- **`getFileInfo(uri)`** (`:58-112`):
  - `val queryResult: Cursor = resolver.query(uri, null, null, null, null)!!` (`:69`);
  - `queryResult.moveToFirst()` unchecked, then `getString(getColumnIndex(DISPLAY_NAME))` and `SIZE` (`:70-72`);
  - `val mimeType = resolver.getType(uri)!!` (`:75`);
  - the image bounds use `BitmapFactory.decodeStream(resolver.openInputStream(uri) …)` (`:80-86`);
  - the video uses `MediaMetadataRetriever().setDataSource(instance?.getAbsolutePath(uri))` (`:88-99`), which throws on a null path;
  - it returns `contentUri`, `filePath` (= `getAbsolutePath(uri)`), `fileName`, `fileSize`, `mimeType`, `width`, `height` and `duration` (`:102-111`).
- **`handleShareIntent`** calls `getFileInfo(uri)` for SEND (`:145`) and `uris.map { getFileInfo(it) }` for SEND_MULTIPLE (`:151`), unguarded.
- **`getAbsolutePath(uri)`** (`:220-269`):
  - for an ExternalStorage "primary" document it returns the raw `Environment.getExternalStorageDirectory() + "/" + split[1]` (`:229-231`), with no copy;
  - every other `content://` path goes through `getDataColumn`, which **copies the stream into `context.cacheDir`** and returns that path (`:285-334`).
- **The JS `parseShareIntent`** (`build/utils.js:87-110`) sets `path = file.path || ("file://" + filePath) || contentUri`. It calls `file.mimeType.startsWith(...)` for every file, so `mimeType` must never be null.
- **Zilar's send** (T-1895, `apps/mobile/src/lib/share-send.ts`) accepts only `content://` or a `file://` inside `Paths.cache`. So the raw `/storage/...` path from a Files-app share is refused today.

### Steps
1. **Create the patch** with pnpm's own flow:
   - `pnpm patch expo-share-intent@8.0.1 --edit-dir <a tmp dir>`;
   - edit only `android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt` there;
   - `pnpm patch-commit <that dir>`.

   This writes `patches/expo-share-intent@8.0.1.patch` and `patchedDependencies` (in `pnpm-workspace.yaml` or the root `package.json`, wherever pnpm 10 puts it; say which in your Report).
2. **Kotlin changes:**
   - **a. `getFileInfo`:**
     - `resolver.query(...)` may be null. Use `?.use { c -> if (c.moveToFirst()) { … } }`, reading the name and size only when `getColumnIndex` ≥ 0; otherwise both stay null;
     - `val mimeType = resolver.getType(uri) ?: "application/octet-stream"`.
   - **b.** Wrap the image-bounds block and the video-metadata block each in `try { … } catch (e: Exception) { }`, leaving width/height/duration null. Close the input stream (`use`).
   - **c. `handleShareIntent`:** wrap each `getFileInfo(...)` call in try/catch. On an exception call `notifyError("cannot read shared file")` and skip that file. Send the share only if at least one file is left; otherwise only the error.
   - **d. `getAbsolutePath`, the "primary" branch (`:229-231`):** return `getDataColumn(uri, null, null)` (the cache copy) instead of the raw storage path, so every shared file lands in the app cache.
3. **No app code changes.** No tests (native glue; the lead tests on the emulator). Run `pnpm install` so the patch applies, then `pnpm gate`.

### Allowed files
- `patches/expo-share-intent@8.0.1.patch`
- `pnpm-workspace.yaml`
- `package.json`
- `pnpm-lock.yaml`
- `work/T-1908-share-intent-patch.md`

### Checks
```bash
pnpm install
pnpm gate
```

### Acceptance
- **The patch applies on install.**
- **A share whose uri gives no metadata** (or an unreadable file) no longer crashes the app. A file the app can read still arrives with its name, size and type.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Created the patch with pnpm's own flow: `pnpm patch expo-share-intent@8.0.1 --edit-dir <tmp>` → edits → `pnpm patch-commit <tmp>`. pnpm 10 wrote `patchedDependencies` into **`pnpm-workspace.yaml`** (not the root `package.json`) and generated `patches/expo-share-intent@8.0.1.patch` plus the matching lockfile entries.
- Patched only `android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt`:
  - **`getFileInfo`:** `fileName`/`fileSize` now start as `null`; the resolver query uses `?.use { … }` and reads `DISPLAY_NAME`/`SIZE` only when `moveToFirst()` is true and the column index is `>= 0`. `mimeType` falls back to `"application/octet-stream"` when `resolver.getType(uri)` is null.
  - **Image bounds:** wrapped in `try/catch (Exception)`; the input stream is closed with `use`; on failure width/height stay null.
  - **Video metadata:** wrapped in `try/catch (Exception)`; the `MediaMetadataRetriever` is released in `finally`; on failure width/height/duration stay null.
  - **`handleShareIntent`:** SEND and SEND_MULTIPLE now guard every `getFileInfo` call with try/catch, call `notifyError("cannot read shared file")` and skip that file. The share event is sent only when at least one file remains; otherwise only the error is emitted.
  - **`getAbsolutePath` primary branch:** now returns `getDataColumn(uri, null, null)` (the cache copy) instead of the raw `/storage/...` path, so Files-app shares land in the app cache like every other `content://` share.
  - Removed the now-unused `android.os.Environment` import.
- No app code changes and no tests, per the spec (native glue; the lead verifies on the emulator).

### Files changed
- `patches/expo-share-intent@8.0.1.patch` (new)
- `pnpm-workspace.yaml` (adds `patchedDependencies`; pnpm also re-sorted a few existing keys as a side effect of its manifest normalization)
- `pnpm-lock.yaml` (patch hash + snapshot entry; pnpm also re-sorted the `overrides` keys)
- `work/T-1908-share-intent-patch.md` (status + this report)

### Checks run
- `pnpm install` → `Done in 5.2s using pnpm v10.32.1`; the patched package resolves with `patch_hash=401406dd…` and the patched file in `node_modules` contains the changes.
- `pnpm gate` (from the repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (9.4s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: the change touches only patched Android Kotlin glue, and the spec says no tests.

### Round (pre-review fixes)
- **Finding 1 (should-fix) — fixed.** The resolver-null early return in `getFileInfo` now includes `"mimeType" to "application/octet-stream"`, so the map always carries a non-null `mimeType` and the JS `parseShareIntent` cannot hit `undefined.startsWith(...)`.
  - Re-created the patch through pnpm's flow: `pnpm patch expo-share-intent@8.0.1 --edit-dir /tmp/zilar-T-1908-share-patch-1` (the edit dir already contained the previous patch changes; only the one map line was added), then `pnpm patch-commit /tmp/zilar-T-1908-share-patch-1`. The patch now has `patch_hash=20ce0f19…`; pnpm updated `pnpm-lock.yaml`.
  - Verified after `pnpm install`: the installed file contains the new `mimeType` line in the early return.
- **Finding 2 (nit) — not touched.** The dead `docId`/`split`/`type` computation above the `"primary"` branch is outside the finding's behaviour and the brief says nits only if already in a changed line; this round changes a different hunk.
- **Tests added: none.** The changed code is patched Android Kotlin glue with no test harness in the repo, and the task spec explicitly says no tests (the lead verifies on the emulator). No finding named a test.
- `pnpm install` → `Done in 3s using pnpm v10.32.1`.
- `pnpm gate` (from the repo root, after the patch regeneration):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.2s)
  PASS  lint  (0.9s)
  PASS  typecheck  (11.8s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single test files were run: no test file matches this change.

### Round (fresh-session verification)
- Re-read `AGENTS.md`, this task file and `PREREVIEW.md` in a new session; the finding-1 fix was already committed (`f7370bd22`), nothing else was outstanding (must-fix=0, should-fix=1 fixed, nit=1 left alone per the brief).
- `pnpm install` → `Done in 3s using pnpm v10.32.1`; installed package still resolves as `expo-share-intent@8.0.1_patch_hash=20ce0f19…` and the installed `.kt` file contains both `"mimeType" to "application/octet-stream"` lines (early return and main path). `apps/mobile/node_modules/expo-share-intent` points at that patched store entry.
- `pnpm gate` (from the repo root, final run of this round):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck  (0.8s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Tests added: none (same reason as above; no test harness for patched Kotlin glue, and the spec says no tests).
- Finding 2 (nit) remains untouched: it would only tidy the now-dead `docId`/`split`/`type` lines above the `"primary"` branch, and the brief forbids nit changes outside a line already being changed.

### Disagreements
None.

### Notes for the lead
- The two app-side behaviours to check on the emulator: (1) sharing an image whose cursor is empty (the T-1895 crash) must now deliver the file with null name/size or at worst emit `cannot read shared file`, never crash; (2) a Files-app share of a "primary" document must arrive as a `file://` path inside `Paths.cache`, which `share-send.ts` accepts.
- `notifyError("cannot read shared file")` is shown per unreadable file; with a mixed multiple-share the readable files are still delivered.
- The lockfile/workspace key reordering is pnpm's own normalization on install, not a hand edit; only the `patchedDependencies` entries are task content.

## Review (written by Claude)

Merged on 2026-10-17 at HEAD `48e41b1a8`. The NEEDS LEAD packet (20:53) predates the fix `f7370bd22` (20:56), which adds `mimeType` on the resolver-null path.
- **The patch:**
  - nullable `query`, guarded `moveToFirst` and column indexes, and `getType ?: application/octet-stream`;
  - try/catch around image and video probing;
  - each file guarded in `handleShareIntent`;
  - Files-app primary-storage shares are copied into the cache.

  `pnpm-workspace.yaml` keeps the same keys (pnpm reordered them).
- **Emulator** (native rebuild, mock):
  - **the unreadable share:** the same `content://media/external/images/media/21` share that crashed the app on T-1895 now shows "1 file · file". Send then shows "Could not read that file. Try again." and keeps the screen, with 0 FATAL in logcat;
  - **a real share:** Google Photos → Share → Zilar in the Android share sheet → "1 file · share-test.png" → Ana → Send opens Ana's chat with the photo sent (21:04 ✓).
- **Found:** a second share while `/share` is still open keeps the previous chat pick and error line. T-1910 fixes it.

