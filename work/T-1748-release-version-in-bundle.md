---
id: T-1748
title: "Release APKs embed the real version: pass ZILAR_VERSION_NAME/CODE to the Gradle build too (the bundled app config said 0.1.0 with no versionCode, so the in-app updater thought every release was a local build), and fail the job if the APK's app config doesn't match the tag"
status: merged
milestone: M5
branch: task/T-1748-release-version-in-bundle
model: auto
effort: default
depends_on: []
estimate: 15 min
---

# T-1748: The release APK knows its own version

## Spec (written by Claude, do not edit)

### Why
On 2026-10-16 Julio's phone runs v0.2.4. Android's App info shows "Version 0.2.4", but Settings › This app shows "Zilar 0.1.0 · Local build" and offers no update. The lead unzipped the v0.2.5 release APK: `assets/app.config` holds `"version": "0.1.0"` and no `android.versionCode`.

### Facts (the lead read them on 2026-10-16)
- **`.github/workflows/android-release.yml` (214 lines):**
  - `:114-119`: the "Prebuild the Android project" step is the only one with `ZILAR_VERSION_NAME` and `ZILAR_VERSION_CODE` in `env`, so the native `versionName` is right;
  - `:123-139`: the "Build the APKs" step (`./gradlew assembleRelease`) doesn't set them. That's the step where Expo evaluates `apps/mobile/app.config.ts` again and embeds it in `assets/app.config`, which falls back to `version: "0.1.0"` (`apps/mobile/app.json:5`) with no `versionCode` (`apps/mobile/app.config.ts:15-40`);
  - `:143-165`: "Verify the signatures and the baked server URL" already unzips each APK.
- **The app reads `Constants.expoConfig.version` and `Constants.expoConfig.android.versionCode`** (`apps/mobile/src/lib/use-app-update.ts:86-94`). `updateEnabled()` is false when `versionCode` is missing (`:97-99`), and `apps/mobile/src/components/settings/app-version-row.tsx:146-151` then shows "Local build" with no check.

### Steps
1. **In `android-release.yml`,** add `ZILAR_VERSION_NAME: ${{ steps.version.outputs.name }}` and `ZILAR_VERSION_CODE: ${{ steps.version.outputs.code }}` to the `env` of the "Build the APKs" step. Keep them on the prebuild step.
2. **In the "Verify…" step,** for each APK, read `unzip -p "$apk" assets/app.config` and fail with a clear `::error::` unless its `version` equals the tag's name and `android.versionCode` equals the code. Use `node -e` or `jq`, whichever the runner already has; `jq` is on the GitHub Ubuntu runners.
3. **Change no app code and add no tests.**

### Allowed files
- `.github/workflows/android-release.yml`
- `work/T-1748-release-version-in-bundle.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **The Gradle step gets both variables,** and the verify step fails on a mismatched `assets/app.config`.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did

Both changes are in `.github/workflows/android-release.yml`; no app code, no tests.

1. **"Build the APKs (arm64 and universal)" step now gets the tag's version.** Added
   `ZILAR_VERSION_NAME: ${{ steps.version.outputs.name }}` and
   `ZILAR_VERSION_CODE: ${{ steps.version.outputs.code }}` to its `env` (`:129-132`),
   next to `EXPO_PUBLIC_ZILAR_API_URL`. The prebuild step keeps its copy. Expo evaluates
   `apps/mobile/app.config.ts` again during this Gradle step (`apps/mobile/app.config.ts:39-47`
   sets `version` from `ZILAR_VERSION_NAME` and `android.versionCode` from
   `ZILAR_VERSION_CODE`), so the config embedded in `assets/app.config` now comes from the tag
   instead of falling back to `apps/mobile/app.json:5`'s `0.1.0` with no `versionCode`.
2. **The verify step fails on a mismatched bundle.** The step now takes
   `VERSION_NAME`/`VERSION_CODE` from the same `steps.version` outputs. For every APK it
   reads `unzip -p "$apk" assets/app.config` and requires
   `.version == $name and .android.versionCode == $code` with `jq -e` (`:168-181`). On any
   failure it prints a single `::error::` naming the APK, the version it actually bundles,
   and the tag's version/versionCode, then exits 1. A missing `assets/app.config` also fails
   with its own `::error::`, and the closing message now reports the bundled version. `jq`
   is preinstalled on the GitHub Ubuntu runners (`unzip` and `jq` are both used/available there).
   The existing signature and server-URL checks are untouched.

### Checks run

- `pnpm install` — `Done in 17.3s` (only the pre-existing `@types/react-dom` peer warning).
- `pnpm exec prettier --check .github/workflows/android-release.yml` — "All matched files use Prettier code style!"
- Parsed the workflow with `yaml@2.9.1` (`node -e`) — 15 steps, the Build step's env carries both
  `ZILAR_VERSION_NAME`/`ZILAR_VERSION_CODE` from `steps.version.outputs`, and the Verify step's
  `run` contains the `assets/app.config` + `jq` versionCode check.
- Ran the verify logic for real on locally built zip files (same shell code as the workflow's
  body, `zip`/`unzip`/`jq` on this machine):
  - `{"version":"0.2.5","android":{"versionCode":205}}` → OK, exit 0;
  - `{"version":"0.1.0"}` (the v0.2.5 bug) → `::error::… bundles version 0.1.0 (versionCode null), but the tag v0.2.5 needs 0.2.5 (versionCode 205).`, exit 1;
  - versionCode 204 vs 205 → error, exit 1;
  - corrupt JSON → `::error::… bundles version unreadable …`, exit 1;
  - APK with no `assets/app.config` → `::error::… has no assets/app.config …`, exit 1.
- `pnpm gate` from the repo root:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (0.4s)
  PASS  lint  (1.0s)
  PASS  typecheck  (1.9s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  No files outside the Allowed files. No single test files were run: the task changes only a
  workflow file and says "change no app code and add no tests".

### Notes for the lead

- Deviations from the spec: none. I used `jq` (spec allowed `node -e` or `jq`).
- The check compares `android.versionCode` numerically, so a bundle that carried it as a string
  would fail; Expo writes it as the number from `app.config.ts`, so this is what we want.
- I could not run the workflow itself here (it needs the release keystore, Google services and the
  Android SDK); the verification logic above was exercised against real zip files with the same
  shell code, and the workflow is structurally valid YAML. The next tag push is the real smoke.
- No other task's file, `AGENTS.md`, `work/BOARD.md` or `docs/PROJECT_PLAN.md` was touched.

## Review (written by Claude)

- **Accepted at `f44aab31b`.** The pre-review is clean and the packet is current.
- **The diff:**
  - the "Build the APKs" step now gets `ZILAR_VERSION_NAME` and `ZILAR_VERSION_CODE`;
  - the verify step reads `assets/app.config` from each APK with `unzip -p` and fails through `jq -e` unless `version` and `android.versionCode` match the tag.
- **The real smoke is the v0.2.6 tag.** The lead checks `assets/app.config` in the published APK afterwards.
