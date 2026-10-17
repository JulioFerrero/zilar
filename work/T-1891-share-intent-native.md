---
id: T-1891
title: "Share into Zilar, task 1 (native): add expo-share-intent 8.0.1 to the phone app, its config plugin in app.json (Android SEND/SEND_MULTIPLE for text, links, images, video and files; iOS off for now) and the ShareIntentProvider at the root — no route or UI yet"
status: merged
milestone: M5
branch: task/T-1891-share-intent-native
model: auto
effort: default
depends_on: [T-1884]
estimate: 35 min
---

# T-1891: The share-intent library (share plan task 1)

## Spec (written by Claude, do not edit)

### Why
**`docs/plan/share-into-zilar.md` §1 and §6 task 1.** Julio approved it on 2026-10-17: Zilar should appear in Android's share sheet. This task adds only the native library and its wiring. The `/share` route, the picker and the send path are later tasks.

### Facts (read by the lead on 2026-10-17)
- **The app:** Expo `~57.0.25`, `expo-linking`, `expo-constants` (`apps/mobile/package.json:33,36,46`). The plan checked that `expo-share-intent` **8.0.1** is the SDK 57 line, with peers `expo ^57`, `expo-linking >=57.0.1` and `expo-constants >=57.0.3`; the pre-reviewer confirmed it on the npm registry.
- **`apps/mobile/app.json`:**
  - the `plugins` array starts at `:46`;
  - Android intent filters are VIEW-only App Links (`:22-38`), and they must stay unchanged;
  - the scheme is `zilar` (`:8`).
- **The root layout:** `apps/mobile/src/app/_layout.tsx` (143 lines) wraps the app in `KeyboardProvider` → `ThemeProvider` → … → `ChatStoreProvider` (`:125-140`).
- **`apps/mobile/src/app/+native-intent.tsx`** (9 lines) maps system paths. **Don't change it here;** task 4 adds the `/share` branch with the route.

### Steps
1. **Install:** `pnpm --filter @zilar/mobile add expo-share-intent@8.0.1` (exact version, no caret). That updates `apps/mobile/package.json` and `pnpm-lock.yaml`.
2. **Read the plugin's options** in `apps/mobile/node_modules/expo-share-intent/plugin/src/types.ts` (or `build/`), then add to `app.json` `plugins`:
   ```json
   ["expo-share-intent", {
     "androidIntentFilters": ["text/*", "image/*", "video/*", "application/*", "audio/*"],
     "androidMultiIntentFilters": ["image/*", "video/*"],
     "disableIOS": true
   }]
   ```
   - **iOS stays off for now:** the plan's iOS phase needs a share-extension target and credentials. If the option is named differently, use the real name and say so in your Report.
   - **If there is no way to turn iOS off,** stop and report it; don't add iOS rules.
   - Keep the existing VIEW filters byte-for-byte.
3. **`_layout.tsx`:** import `ShareIntentProvider` from `expo-share-intent` and wrap it directly outside `ChatStoreProvider` with `options={{ resetOnBackground: true }}`. Use the option only if the type has it; otherwise use no options. Add a one-line comment: `T-1891: share-sheet payloads (Android SEND); the /share route reads them (share plan).`
4. **Prebuild check:** run `pnpm --filter @zilar/mobile exec expo prebuild --platform android --clean --no-install`. Then confirm `android/app/src/main/AndroidManifest.xml` has `android.intent.action.SEND` and `SEND_MULTIPLE` filters on the main activity, and still has the App Link VIEW filter.
   - `android/` is generated and not committed (check `.gitignore`); don't commit it.
   - Paste the relevant manifest lines into your Report.
5. **No tests** (native wiring). Every touched file stays at most 400 lines.

### Allowed files
- `apps/mobile/package.json`
- `pnpm-lock.yaml`
- `apps/mobile/app.json`
- `apps/mobile/src/app/_layout.tsx`
- `work/T-1891-share-intent-native.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **`expo-share-intent@8.0.1` is a dependency.**
- **`app.json` adds the plugin** with Android text/link/media/file filters and iOS off. The App Links are unchanged.
- **`ShareIntentProvider` wraps the app.**
- **The prebuilt Android manifest** shows the SEND and SEND_MULTIPLE filters.
- The gate passes.

---

## Report (written by the worker when done)

### What I did
- Added `expo-share-intent` at the exact version `8.0.1` (no caret) to `apps/mobile/package.json` with `pnpm --filter @zilar/mobile add expo-share-intent@8.0.1`; `pnpm-lock.yaml` updated.
- Added the `expo-share-intent` config plugin to `apps/mobile/app.json` `plugins`, after the existing entries, with:
  `androidIntentFilters: ["text/*", "image/*", "video/*", "application/*", "audio/*"]`,
  `androidMultiIntentFilters: ["image/*", "video/*"]` and `disableIOS: true`.
  The option names match the plugin's `Parameters` type (`plugin/build/types.d.ts`); `disableIOS` is the real switch (prebuild logged `[expo-share-intent] IOS module disabled`). The existing App Link VIEW `intentFilters` (lines 23-39) are unchanged. Note: the plugin's TypeScript type for `androidIntentFilters` only lists `"text/*" | "image/*" | "video/*" | "*/*"`, but the values are passed straight into the manifest as `android:mimeType` (`plugin/build/android/withAndroidIntentFilters.js`), so `application/*` and `audio/*` work and the prebuilt manifest shows them (see below).
- `apps/mobile/src/app/_layout.tsx`: imported `ShareIntentProvider` from `expo-share-intent` and wrapped it directly outside `ChatStoreProvider` with `options={{ resetOnBackground: true }}` (the option exists in `ShareIntentOptions`). Added the one-line comment required by the spec.
- Ran the prebuild check; `apps/mobile/android/` is generated, git-ignored (`apps/mobile/.gitignore:18-19`) and not committed.

### Checks run
- `pnpm install` — done (18.3s).
- `pnpm --filter @zilar/mobile add expo-share-intent@8.0.1` — done; `apps/mobile/package.json:53` has `"expo-share-intent": "8.0.1"`.
- `pnpm --filter @zilar/mobile exec expo prebuild --platform android --clean --no-install` — succeeded; logged `[expo-share-intent] IOS module disabled` and `[expo-share-intent] add android filters (text/* image/* video/* application/* audio/*) and multi-filters (image/* video/*)`.
- Manifest check in `apps/mobile/android/app/src/main/AndroidManifest.xml` — the app-link VIEW filter is intact and both SEND filters are present:
```
      <intent-filter android:autoVerify="true" data-generated="true">
        <action android:name="android.intent.action.VIEW"/>
        <data android:scheme="https" android:host="chat.zilar.app" android:pathPrefix="/c/"/>
        ... (invite, j, u, settings, stickers, @, /)
      </intent-filter>
      <intent-filter>
        <action android:name="android.intent.action.SEND"/>
        <data android:mimeType="text/*"/>
        <data android:mimeType="image/*"/>
        <data android:mimeType="video/*"/>
        <data android:mimeType="application/*"/>
        <data android:mimeType="audio/*"/>
        <category android:name="android.intent.category.DEFAULT"/>
      </intent-filter>
      <intent-filter>
        <action android:name="android.intent.action.SEND_MULTIPLE"/>
        <data android:mimeType="image/*"/>
        <data android:mimeType="video/*"/>
        <category android:name="android.intent.category.DEFAULT"/>
      </intent-filter>
```
- No unit tests (native wiring; spec says no tests). Single test files: none run.
- `pnpm gate` — GATE PASS:
```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.9s)
PASS  lint  (1.0s)
PASS  typecheck  (4.6s)
PASS  effect  (0.9s)
SKIP tests @zilar/mobile (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
- Files changed: `apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/app.json`, `apps/mobile/src/app/_layout.tsx`, `work/T-1891-share-intent-native.md`.

### Notes for the lead
- The only deviation is the one described above: the plugin's TS type for `androidIntentFilters` does not include `application/*`/`audio/*` (it suggests `*/*` instead), but the values are copied verbatim into the manifest, which the prebuild output confirms. If you prefer the narrower `*/*`, it is a one-line change in `app.json`.
- `+native-intent.tsx` was not touched, as instructed; the `/share` route is a later task.

## Review (written by Claude)

Merged on 2026-10-17; the packet matches HEAD `5fd358c09`. Julio approved the native dependency at 17:35.
- **The dependency:** `expo-share-intent` is pinned to `8.0.1`.
- **The plugin:** Android filters for text, image, video, application and audio, plus multi image/video; `disableIOS: true` (confirmed by the prebuild log).
- **The provider:** `ShareIntentProvider` (`resetOnBackground`) wraps `ChatStoreProvider`.
- **The manifest** (pasted in the Report) keeps the App Link VIEW filter and adds SEND and SEND_MULTIPLE.
- **Not in v0.2.8:** the tag predates this, so it ships with the share route in the next APK. The share-sheet check is plan task 7 (the phone smoke).
