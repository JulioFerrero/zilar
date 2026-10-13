---
id: T-1321
title: "iOS opens files in the in-app QuickLook preview like Telegram (PDF, docs) instead of the share sheet, via one maintained community library; Android unchanged"
status: merged
milestone: M5
branch: task/T-1321-ios-file-preview
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1321: iOS file preview (QuickLook)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-13: tapping a PDF should open it like Telegram. T-1319 did Android (a VIEW intent via `expo-intent-launcher`). **iOS still calls `Share.share`** (`apps/mobile/src/lib/attachment-opener.ts:10,19`, 179 lines), which shows the share sheet. Telegram on iOS opens an in-app QuickLook preview, with a share button inside it. Expo has no official QuickLook module, and Julio approved one community library (2026-10-13, "Yes, add it").

### What to build
1. **Pick one maintained library** that presents `QLPreviewController` for a local file and supports the New Architecture on React Native 0.86 (`apps/mobile/package.json`). First choice: `react-native-file-viewer-turbo`. Check on npm that it was published in the last 12 months and supports New Architecture / TurboModules, and cite its version. If it doesn't fit, pick an equivalent and say why. Pin an exact version that is at least two weeks old. Add it to `apps/mobile/package.json` and run `pnpm install`. It must autolink under Expo prebuild; if it needs a config plugin, add it to `apps/mobile/app.json`.
2. In `attachment-opener.ts`, on **iOS only**, after the existing download step, open the downloaded file with the library's preview (`displayName` = the clean file name).
   - If it throws (unsupported type, or the library is missing on an old build), fall back to `Share.share`.
   - **Android is unchanged** (T-1319's intent path).
   - The file must stay at most 400 lines.
3. **No tests** (native glue). Keep `apps/mobile/src/lib/attachments.test.ts` passing.

### Read first
`AGENTS.md`, `apps/mobile/src/lib/attachment-opener.ts`, `work/T-1319-mobile-file-bubble-open.md` (Report), and `apps/mobile/package.json`.

### Allowed files
`apps/mobile/src/lib/attachment-opener.ts`, `apps/mobile/package.json`, `apps/mobile/app.json`, `pnpm-lock.yaml`, `work/T-1321-ios-file-preview.md`.

### Checks
```bash
pnpm --filter @zilar/mobile exec vitest run src/lib/attachments.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check:** an iOS release build compiles with the library (`expo prebuild` + `pod install` + `xcodebuild`).
- **Julio's check on Iryna's iPhone:** tapping a PDF opens the preview.

---

## Report (written by the worker when done)

### What I did

**The library (first choice fits).** I picked `react-native-file-viewer-turbo`,
pinned to the exact version **`0.7.5`**.

- It is the maintained fork of the abandoned `react-native-file-viewer`; on iOS it
  presents `QLPreviewController` for a local file (QuickLook), and its `open(path,
  { displayName })` is exactly the API the spec asks for.
- **New Architecture / TurboModules:** the description is "Native file viewer for
  react-native - now with TurboModules support"; it ships a `codegenConfig`
  (`RNFileViewerTurboSpec`, `type: modules`) and `create-react-native-library` type
  `turbo-module`. Since `0.7.0` it is New Architecture only, and it requires RN
  `>= 0.76.3`; this app is RN `0.86.3`, so it fits.
- **Published within 12 months and at least two weeks old:** npm publish times are
  `0.8.0` → 2026-10-07 (6 days ago), `0.7.5` → 2026-04-02. `0.8.0` is under two
  weeks old, so it fails the "pin an exact version that is at least two weeks old"
  rule; `0.7.5` is the newest version that satisfies it. `0.7.5` is ~6 months old,
  well inside the 12-month window, and is a feature-complete release of the same
  New-Architecture line.
- Added `"react-native-file-viewer-turbo": "0.7.5"` to `apps/mobile/package.json`
  (alphabetical, exact version) and ran `pnpm install`; it autolinks under Expo
  prebuild (podspec ships iOS sources and links the `QuickLook` framework).

**Config plugin:** `apps/mobile/app.json` is **unchanged**. The package ships
`app.plugin.js`, but its source (`src/plugin/withFilePreviewTurbo.ts`) only pushes
an Android `<queries>` VIEW/MIME entry into `AndroidManifest.xml`, and only when
the config's `platforms` include `android`. Android keeps T-1319's
`expo-intent-launcher` path and never calls this library, so the plugin is not
needed and adding it would be an Android-manifest change. No iOS web/plugin step is
required beyond the autolinked pod.

**The opener** (`apps/mobile/src/lib/attachment-opener.ts`, 179 → 205 lines, under
the 400 cap):

- New `openInQuickLook(file, name)` step: imports the module **lazily**
  (`import('react-native-file-viewer-turbo')`, the same pattern `voice-recorder.ts`
  uses for a native module) and calls `open(file.uri, { displayName:
  cleanFilename(name) })`.
- In `openEffect`, an **iOS** branch runs after the existing download: it tries
  QuickLook and on success returns `{ status: 'opened' }`; any throw (unsupported
  type, or the module missing) falls through to the existing `Share.share`.
- **Android is unchanged**: the `Platform.OS === 'android'` block still sends the
  `android.intent.action.VIEW` intent via `expo-intent-launcher`, with the same
  `Share.share` fallback.
- The lazy import matters: `TurboModuleRegistry.getEnforcing('FileViewerTurbo')`
  runs at module load, so a static import would throw at app startup on an older
  build that lacks the native module and would bypass the share fallback. Deferring
  it to the tap keeps the spec's "library is missing on an old build → fall back to
  `Share.share`" working.

**No tests added** (native glue), per the spec; `attachments.test.ts` still passes.

### Files changed

- `apps/mobile/package.json` — added `react-native-file-viewer-turbo@0.7.5`.
- `apps/mobile/src/lib/attachment-opener.ts` — iOS QuickLook open + share fallback.
- `pnpm-lock.yaml` — the new dependency.
- `work/T-1321-ios-file-preview.md` — this report.

(`apps/mobile/app.json` is in scope but unchanged, see above.)

### Commands and results

- `pnpm install` — done; added `react-native-file-viewer-turbo@0.7.5` (1 package
  downloaded).
- `pnpm --filter @zilar/mobile exec vitest run src/lib/attachments.test.ts
  --reporter=dot` — 1 file passed, 4 tests passed, 382ms.
- `pnpm gate` — **GATE PASS**:
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (3.2s)
PASS  effect  (0.7s)
PASS  tests @zilar/mobile  (1.2s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

I could not run `expo prebuild` / `pod install` / `xcodebuild` or an iPhone check
from here; only the gate and the unit test ran. The compile and phone checks are
the lead's and Julio's.

### Deviations from the spec

1. **Pinned `0.7.5`, not the latest `0.8.0`.** `0.8.0` was published 2026-10-07
   (6 days before this task), so it fails the spec's "at least two weeks old" pin
   rule; `0.7.5` is the newest version that satisfies it.
2. **No config plugin in `app.json`.** The package's plugin only affects the
   Android manifest and Android is unchanged, so it is not needed (see above).
3. **The library is imported lazily inside the open step**, not with a top-level
   static import, so the "missing on an old build" fallback to `Share.share` can
   actually catch the native-module lookup failure instead of the app crashing at
   startup.

### Open questions

- None blocking. Confirm the `0.7.5` pin and the no-plugin choice are acceptable.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean (1 nit).**
- **Library:** `react-native-file-viewer-turbo` 0.7.5 (published 2026-04-02; the package was updated 2026-10-07; TurboModule codegen). iOS tries QuickLook first and falls back to `Share`; Android is unchanged.
- **Lead's iOS check:** a release device build of this branch (`9feca942`) with prebuild, pod install (the pod `react-native-file-viewer-turbo (0.7.5)` is in `Podfile.lock`) and xcodebuild succeeded, and it's installed on Iryna's iPhone.
- **After the merge:** the lead builds the Android APK to prove Android still compiles with the library's module.
