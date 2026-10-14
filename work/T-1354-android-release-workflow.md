---
id: T-1354
title: "GitHub Releases with APKs: a workflow on tag v* (and manual dispatch) builds the Android release APK signed with Julio's private release key from GitHub secrets, and publishes a GitHub Release with the APKs and generated notes"
status: merged
milestone: M5
branch: task/T-1354-android-release-workflow
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1354: Android release workflow

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: "in github can we make a release part? like with the apks?" He chose CI signing with his own key.
- **Today there are no GitHub Releases** (`gh release list` is empty). Tags `v0.1.9` … `v0.1.13` exist, and a `v*` tag runs `.github/workflows/images.yml` (server images).
- **Android builds are local only** (`docs/RELEASING.md` §7, lines 48-67): `expo prebuild` then `./gradlew assembleRelease`, with `EXPO_PUBLIC_ZILAR_API_URL` baked in.
- **The signing problem:** the generated `android/app/build.gradle` signs **release with the public Expo/React Native debug keystore** (`signingConfig signingConfigs.debug`; `app/debug.keystore`, password `android`). That's not safe for public APKs.
- **Firebase file:** `apps/mobile/app.config.ts` (27 lines) adds `google-services.json` only if the file exists (`:7-24`). The file is git-ignored (`apps/mobile/.gitignore:37`).

### Secrets (Julio adds them; **never** print, log or commit them)
`ZILAR_ANDROID_KEYSTORE_BASE64`, `ZILAR_ANDROID_KEYSTORE_PASSWORD`, `ZILAR_ANDROID_KEY_ALIAS`, `ZILAR_ANDROID_KEY_PASSWORD`, `ZILAR_GOOGLE_SERVICES_JSON_BASE64`.

### What to build
1. **Expo config plugin** `apps/mobile/plugins/with-release-signing.js`, registered in `apps/mobile/app.config.ts`. It adds a `signingConfigs.release` to the generated `android/app/build.gradle` that reads the keystore path, store password, alias and key password from **Gradle properties or environment variables** (`ZILAR_UPLOAD_STORE_FILE`, `ZILAR_UPLOAD_STORE_PASSWORD`, `ZILAR_UPLOAD_KEY_ALIAS`, `ZILAR_UPLOAD_KEY_PASSWORD`). `buildTypes.release` uses it **only when those are set**; otherwise it falls back to today's debug signing, so local dev builds keep working.
2. **Version from the tag:** `versionName` is the tag without `v`, and `versionCode` is `major*10000 + minor*100 + patch` (v0.1.14 → 114). Pass them through `app.config.ts` from env (`ZILAR_VERSION_NAME`, `ZILAR_VERSION_CODE`), keeping today's values when unset.
3. **Workflow** `.github/workflows/android-release.yml`, on `push: tags: ['v*']` and `workflow_dispatch` (input: tag):
   - checkout with tags; pnpm and Node like `ci.yml`; JDK 17; Android SDK (`android-actions/setup-android`, or whatever the runner has); `pnpm install --frozen-lockfile`;
   - decode the keystore and `google-services.json` from secrets into the runner's temp dir. Never `echo` a secret; use `::add-mask::` where needed;
   - `expo prebuild --platform android --clean`, then `./gradlew assembleRelease` with `EXPO_PUBLIC_ZILAR_API_URL=https://chat.zilar.app` and `NODE_ENV=production`, building **two APKs**: arm64-only (`-PreactNativeArchitectures=arm64-v8a`) and universal (all ABIs). Name them `zilar-<tag>-arm64.apk` and `zilar-<tag>-universal.apk`;
   - **verify:** `apksigner verify --print-certs` shows the release certificate, **not** the Android Debug one (fail the job if `CN=Android Debug` appears), and the bundle contains `https://chat.zilar.app` (as `docs/RELEASING.md` §7 does);
   - **publish** a GitHub Release for the tag (`gh release create`, or upload if it exists), with both APKs and their SHA-256 sums, and notes generated from `git log <previous tag>..<tag> --oneline` (merge summaries) plus a short install note: "Android: download the arm64 APK for any recent phone; allow installs from your browser".
   - **Fork safety:** if the secrets are missing, fail early with a clear message; never fall back to debug signing in CI;
   - `permissions: contents: write` for that job only; `timeout-minutes: 60`; `concurrency` per tag.
4. **Docs:** add a §7b "GitHub release APKs" to `docs/RELEASING.md`: the one-time key setup (the commands below), how to cut a release (`git tag v0.1.14 && git push origin v0.1.14`), and a warning that **phones on old debug-signed builds must uninstall once**.
5. **No tests** (CI/config). Every file stays at most 400 lines.

### One-time key setup (goes into the docs; the worker does NOT run it)
```bash
keytool -genkeypair -v -keystore ~/zilar-release.keystore -alias zilar -keyalg RSA -keysize 4096 -validity 10000
base64 -i ~/zilar-release.keystore | gh secret set ZILAR_ANDROID_KEYSTORE_BASE64
gh secret set ZILAR_ANDROID_KEYSTORE_PASSWORD
gh secret set ZILAR_ANDROID_KEY_ALIAS --body zilar
gh secret set ZILAR_ANDROID_KEY_PASSWORD
base64 -i apps/mobile/google-services.json | gh secret set ZILAR_GOOGLE_SERVICES_JSON_BASE64
```

### Read first
`AGENTS.md`, `docs/RELEASING.md`, `.github/workflows/ci.yml`, `.github/workflows/images.yml`, `apps/mobile/app.config.ts`, `apps/mobile/app.json`.

### Allowed files
`.github/workflows/android-release.yml`, `apps/mobile/plugins/with-release-signing.js`, `apps/mobile/app.config.ts`, `docs/RELEASING.md`, `work/T-1354-android-release-workflow.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **Locally,** `expo prebuild --platform android --clean` with no signing env still produces a debug-signed release (unchanged behaviour). With the env set to a throwaway test keystore (made in `/tmp`, never committed), the release signs with it; show `apksigner verify --print-certs` output with the test CN.
- `actionlint` on the workflow, if available (`npx --yes actionlint` or a docker image); say if it's not.
- **After Julio adds the secrets, the lead runs the workflow by dispatch.**

---

## Report (written by the worker when done)

Status: implemented, gate green; local acceptance done; the CI run waits for Julio's secrets (the lead runs it by dispatch).

### What changed

- `apps/mobile/plugins/with-release-signing.js` (new, ~100 lines): an Expo config plugin that uses `withAppBuildGradle` to (1) inject `zilarReleaseProperty`/`zilarReleaseSigning` helpers before the `android {` block, (2) add a `signingConfigs.release` filled only when all four `ZILAR_UPLOAD_*` values are present, and (3) switch `buildTypes.release` to `signingConfig zilarReleaseSigning ? signingConfigs.release : signingConfigs.debug`. It reads each value from a Gradle property (`-P`) first, then the environment. Missing anchors throw instead of silently leaving debug signing.
- `apps/mobile/app.config.ts`: registers the plugin in `plugins`; `version` comes from `ZILAR_VERSION_NAME` and `android.versionCode` from `ZILAR_VERSION_CODE` (a positive integer, else a clear error), both unset → `app.json` values. The google-services.json behaviour is unchanged (still added only when the file exists).
- `.github/workflows/android-release.yml` (new): on `push` tags `v*` and `workflow_dispatch` (input `tag`); checkout with the tag and full history; pnpm + Node from `.nvmrc`; JDK 17 (temurin); `android-actions/setup-android`; `pnpm install --frozen-lockfile`; fail early when any of the five secrets is missing; decode the keystore and `google-services.json` from base64 into `$RUNNER_TEMP`/the app dir (never echoed, passwords masked); derive `versionName`/`versionCode` from the tag; `expo prebuild --platform android --clean --no-install`; `./gradlew assembleRelease` twice (arm64-only, then universal) with `EXPO_PUBLIC_ZILAR_API_URL=https://chat.zilar.app NODE_ENV=production`; verify each APK with `apksigner verify --print-certs` (fails on `CN=Android Debug`) and that the bundle contains the server URL; write `SHA256SUMS`; generate notes from `git log <prev>..<tag> --oneline` plus the install note; `gh release create` (or `edit`+`upload --clobber`). Job-level `permissions: contents: write`, `timeout-minutes: 60`, per-tag `concurrency`.
- `docs/RELEASING.md`: new §7b "GitHub release APKs" with the one-time key setup, how to cut a release, and the uninstall-once warning.
- `work/T-1354-android-release-workflow.md`: status and this report.

### Commands and results

- `pnpm install` — done, clean.
- `ZILAR_VERSION_NAME=0.1.14 ZILAR_VERSION_CODE=114 pnpm exec expo prebuild --platform android --clean --no-install` — finished; generated `android/app/build.gradle` shows `versionCode 114`, `versionName "0.1.14"`, the injected helpers, `signingConfigs.release`, and `signingConfig zilarReleaseSigning ? signingConfigs.release : signingConfigs.debug`.
- Local acceptance, build 1 (no signing env), from `apps/mobile/android`:
  `EXPO_PUBLIC_ZILAR_API_URL=https://chat.zilar.app NODE_ENV=production ./gradlew assembleRelease --console=plain` → `BUILD SUCCESSFUL in 7m 35s`. `apksigner verify --print-certs app-release.apk` → `Signer #1 certificate DN: CN=Android Debug, OU=Android, ...`. The bundle contains the URL: `unzip -p app-release.apk assets/index.android.bundle | grep -a -c https://chat.zilar.app` → `1`. So the default release path is unchanged (debug-signed).
- Local acceptance, build 2 (throwaway key in the approved temp dir, `/private/var/…/opencode/zilar-t1354/test-release.keystore`, alias `zilartest`, never committed):
  `ZILAR_UPLOAD_STORE_FILE=… ZILAR_UPLOAD_STORE_PASSWORD=teststorepass ZILAR_UPLOAD_KEY_ALIAS=zilartest ZILAR_UPLOAD_KEY_PASSWORD=teststorepass … ./gradlew assembleRelease` → `BUILD SUCCESSFUL in 10s` (59 tasks executed). `apksigner verify --print-certs` → `Signer #1 certificate DN: CN=Zilar T1354 Test Release, OU=Test, O=Zilar, L=Test, ST=Test, C=US`; `grep -c "CN=Android Debug"` → `0`.
- `actionlint`: not installed on this machine. `npx --yes actionlint` was declined by the lead (the npm package is a third-party wasm wrapper, not the official tool), so I validated the workflow YAML with the repo's `yaml` package: it parses, the triggers are `push`/`workflow_dispatch`, job permissions are `contents: write` (workflow `contents: read`), concurrency is per tag with `cancel-in-progress: false`, `timeout-minutes: 60`, and the only secrets used are exactly the five the spec names (`ZILAR_ANDROID_KEYSTORE_BASE64`, `ZILAR_ANDROID_KEYSTORE_PASSWORD`, `ZILAR_ANDROID_KEY_ALIAS`, `ZILAR_ANDROID_KEY_PASSWORD`, `ZILAR_GOOGLE_SERVICES_JSON_BASE64`).
- `pnpm gate` (repo root), summary:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.3s)
  PASS  lint  (0.9s)
  PASS  typecheck  (3.4s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/mobile (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  No single test files were run: the change is CI/config and the mobile package has no test next to `app.config.ts` (the gate skipped it).

### Deviations from the spec

- `expo prebuild` carries `--no-install` (as docs §7 already does); dependencies are installed earlier by `pnpm install --frozen-lockfile`, and without the flag prebuild would run a package install again.
- The workflow treats all five secrets as required (it fails if `ZILAR_GOOGLE_SERVICES_JSON_BASE64` is missing too). The spec lists it and says to fail early when the secrets are missing, so FCM is mandatory for a release APK.
- Tested the environment-variable path (what the workflow uses); the Gradle-property path in the plugin is written but was not exercised locally.

### Blocked / needs a decision

None. The workflow was not run: the acceptance says the lead runs it by dispatch after Julio adds the secrets.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean (2 nits); the packet is current for `ca9da2ee`.**
- **Lead's read of the workflow:**
  - it fails early on any missing secret, with no debug fallback;
  - passwords are masked, and the keystore is decoded to `$RUNNER_TEMP` only;
  - the dispatch tag reaches shell only via `env` (no expression injection in `run`);
  - `contents: write` is scoped to the job;
  - the `apksigner` guard blocks `CN=Android Debug`, and a URL check is in place.
- **The worker's local proof:** no env gives debug signing (unchanged), and a throwaway key gives the throwaway CN.
- **actionlint** wasn't run (not installed; the npm wrapper was declined). The YAML was parsed with the repo's `yaml` package.
- **First real run:** waits for Julio's 5 secrets, then the lead dispatches on a new tag.
