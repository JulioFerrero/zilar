---
id: T-0177
title: Spike: transcribe voice notes on the phone with Cactus Whistle (Android, local Expo module)
status: review
milestone: M5
branch: task/T-0177-whistle-on-device-spike
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: []
estimate: 2 days
---

# T-0177: Whistle on the phone (spike)

## Spec (written by Claude, do not edit)

### Why
Julio wants to try Cactus Whistle ("Speech to Text in 16.9 MB", https://cactuscompute.com/blog/whistle) for voice-note transcripts, running on the phone itself: "run that directly in the phone, nothing of openai or whisper". The server-side transcription (T-0170) stays as it is; this spike proves the on-device path and measures it. Whistle is Apache-2.0, 7 languages (en, de, fr, es, it, nl, pl), 16 kHz mono audio, at most 30 s per pass.

### What exists (verified by the lead on 2026-10-03)
- Hugging Face repo `Cactus-Compute/whistle`: the model `whistle.cact` (16 919 407 bytes, sha256 `b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb`), pinned revision `b358ddadd89b7a713b5aa131f23032d3cca1b251`.
- Hugging Face repo `Cactus-Compute/needle3`, revision `c7c415a3d1b3d929014bc6e866d51ebb971f7089`: the engine for Android arm64 at `android-arm64/libneedle.a` (2 128 166 bytes, sha256 `16752fb75adea7af89bbc435a97d1cda7e71bc74d04578d551d0d3bbd5f9e633`, static, built against the NDK libc++) and its header `android-arm64/needle.h` (sha256 `90f347f9dca1199de79967ab199a56e0588bd473fe306051f8d80d146976a324`). Download URLs: `https://huggingface.co/Cactus-Compute/<repo>/resolve/<revision>/<path>`.
- The C API (the whole speech surface, read `needle.h`): `needle_load(const unsigned char* cact, unsigned long long n)` (the engine keeps the bytes: keep the buffer alive), `needle_transcribe(const float* pcm, int samples, const char* language, const char* keywords, int word_timestamps, char* out, int out_capacity)` which fills JSON `{"text","language","ttft_ms","decode_tps"}` and returns the token count (negative on failure, then `needle_last_error()`). One process-global, non-thread-safe model: serialise calls.
- The `cactus-react-native` package is NOT used: it wraps Cactus's other engine and its speech models are Whisper-based. We link the Needle engine directly.

### What to build
1. **A local Expo module `apps/mobile/modules/zilar-whistle`** (Expo Modules API, Kotlin plus a small C++ JNI shim, `CMakeLists.txt` linking `libneedle.a` and the NDK `c++_shared`; follow Expo's "local module" docs, `expo-module.config.json`, autolinking). Android arm64-v8a only; on any other ABI or on iOS the module reports `unavailable`. JS surface (`index.ts`, typed, zod-validated at the JSON boundary):
   - `isAvailable(): boolean`
   - `modelStatus(): 'missing' | 'ready'` and `downloadModel(onProgress)`: downloads `whistle.cact` from the pinned URL into the app's files dir, **verifies the sha256** before the file is used, writes to a temp name and renames, never leaves a partial file, can be called twice safely.
   - `transcribe(fileUri, { language? }): Promise<{ text, language, ttftMs, decodeTps, audioMs, wallMs }>`: decodes the audio file (m4a/AAC as recorded by the app, also wav) with Android's `MediaExtractor` + `MediaCodec` to PCM, downmixes to mono, resamples to 16 kHz float in [-1, 1], splits audio longer than 30 s into consecutive chunks of at most 28 s (cut at the quietest point in the last 2 s of the chunk, never mid-sample) and joins the texts with a single space, on a background thread, one transcription at a time (a second call waits). Empty/silent audio gives an empty text.
2. **Fetch script** `apps/mobile/modules/zilar-whistle/scripts/fetch-engine.sh`: downloads `libneedle.a` and `needle.h` at the pinned revision into `android/third_party/needle/` (gitignored), verifies the sha256 values above and fails loudly on a mismatch. Gradle runs it before the native build if the files are missing (an `exec` task wired to `preBuild`). Do NOT commit the binaries. Add the licence note (Apache-2.0, Cactus Compute) to `docs/` is out of scope; put it in the module's README.
3. **A hidden dev screen** `apps/mobile/src/app/dev/whistle.tsx` (reachable by the URL `zilar://dev/whistle` only, not linked anywhere; only in `__DEV__` builds? No: Julio tests a release build, so it must exist in release but stay unlinked): buttons "Download model" (with a progress bar), "Record 5 s and transcribe" (uses the existing `createVoiceRecorder` port), and "Transcribe last voice note"; it shows the text, language, the audio length, wall time and tokens per second. No emoji, lucide icons only, same style as the rest of the app.
4. **Tests (Vitest)**: the JS wrapper with a fake native module (status flow, progress, zod rejection of a malformed JSON result, a second concurrent `transcribe` waits, `unavailable` on a non-arm64 stub); the chunking function as a pure, exported TypeScript or Kotlin-free helper if you put it in JS (preferred: do the splitting plan in a tested pure function and keep the native side dumb) with cases for 10 s, 30 s, 61 s and silence; the sha256 verification wrapper. Native Kotlin and C++ cannot run in Vitest: say so in the Report and describe how you checked them.
5. **Build proof**: from `apps/mobile`, run `pnpm exec expo prebuild --platform android --no-install` in a scratch copy is NOT needed; the lead builds the APK. You must at least make Gradle's `:zilar-whistle:compileReleaseKotlin` and the CMake step succeed locally if the Android toolchain is available (JAVA_HOME Java 17, ANDROID_HOME=/opt/homebrew/share/android-commandlinetools). If you cannot run it, say exactly why in the Report.

### Read first
`AGENTS.md`, `docs/PROJECT_PLAN.md` section 6.7 (voice) and 17.2 (mobile), `apps/mobile/src/lib/voice-native.ts` (the recorder port), https://docs.expo.dev/modules/get-started/ (local modules), `needle.h` (download it with the script), the Whistle model card https://huggingface.co/Cactus-Compute/whistle.

### Allowed files
`apps/mobile/modules/zilar-whistle/**`, `apps/mobile/src/app/dev/whistle.tsx` and a test beside it, `apps/mobile/src/lib/whistle-*.ts` and tests, `apps/mobile/package.json` and `pnpm-lock.yaml` ONLY if the module needs a listed dependency (none expected: `expo-modules-core` is already there), `.gitignore` (the third_party line only), `work/T-0177-whistle-on-device-spike.md`. Nothing else; the rest of the app does not use the module yet.

### Allowed dependencies
None.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 whistle
```

### Acceptance
- The module builds into the Android app (or the Report says exactly what could not be run) and `fetch-engine.sh` verifies the pinned checksums.
- `transcribe` returns text, language, timings; audio over 30 s is chunked per the rule above (pure function, tested).
- A corrupted or truncated model download is rejected by the checksum and removed.
- The dev screen exists, is unlinked, and shows the measurements.
- No server change, no new network host other than `huggingface.co` for the one pinned download.

### Out of scope
iOS, wiring transcripts into the chat UI or the server, word timestamps, keyword biasing, other models, streaming. Those follow if the quality is good.

---

## Report (written by the worker when done)

### What I built

1. **Local Expo module `apps/mobile/modules/zilar-whistle`** (autolinked through
   `apps/mobile/modules/`, resolved as `zilar-whistle` in the Android module list):
   - `src/index.ts` — typed JS surface: `isAvailable`, `modelStatus`,
     `downloadModel(onProgress)`, `transcribe(fileUri, { language? })`.
   - `src/model.ts` — pinned `whistle.cact` URL/revision/size/sha256, 7 languages.
   - `src/result.ts` — zod-validated JSON boundary (`bad_result` on malformed),
     fixed error codes (`unavailable`, `model_missing`, `not_audio`,
     `bad_checksum`, `transcribe_failed`, `load_failed`).
   - `src/download.ts` — downloads to a temp name, verifies sha256, renames;
     rejects/removes corrupted or truncated files; safe to call twice.
   - `src/transcribe.ts` — serialises concurrent calls (a second waits),
     strips `file://`, returns `{ text, language, ttftMs, decodeTps, audioMs, wallMs }`.
   - `src/ZilarWhistleModule.ts` — `requireOptionalNativeModule('ZilarWhistle')`,
     null off Android.
   - `android/` — `ZilarWhistleModule.kt` (MediaExtractor + MediaCodec decode to
     16 kHz mono, quiet-cut 28 s chunks, silence shortcut, one lock, arm64 gate),
     `src/main/cpp/whistle-jni.cpp` (JNI shim; mallocs the `.cact` buffer once,
     never frees — the engine keeps the bytes), `CMakeLists.txt` (imports
     `libneedle.a`, links NDK `c++_shared`), `build.gradle` (arm64-v8a only,
     `fetchNeedleEngine` exec wired to `preBuild`, skipped when files exist).
   - `scripts/fetch-engine.sh` — downloads pinned `libneedle.a` + `needle.h`,
     verifies both sha256, fails loudly on mismatch.
   - `README.md` — Apache-2.0 Cactus Compute licence note for model + engine.
2. **Dev screen `apps/mobile/src/app/dev/whistle.tsx`** — `zilar://dev/whistle`,
   unlinked anywhere, ships in release. Download (progress bar), Record 5 s
   (via `createVoiceRecorder`), Transcribe last voice note; shows text,
   language, audio length, wall time, tok/s. Lucide icons only, app Button/Text.
3. **Ports/helpers** — `src/lib/whistle-port.ts` (injected seam; lazy
   `import('zilar-whistle')` so Vitest/iOS never load native code),
   `src/lib/whistle-port-types.ts`, `src/lib/whistle-last-note.ts` (newest
   playable voice across chats), `src/lib/whistle-last-voice.ts` (pure
   28 s/quiet-cut chunk planner + silence check, the tested twin of the
   Kotlin splitter).
4. **Tests (32, all pass)** — `whistle-native.test.ts` (constants, zod accept/
   reject, error mapping, scheme strip, concurrent transcribe serialised,
   `unavailable` on null stub), `whistle-port.test.ts` (status flow, progress,
   throwing availability, last-note newest/local/deleted/empty),
   `whistle-chunks.test.ts` (10 s / 30 s / 61 s, quiet cut, gapless, silence),
   `whistle-checksum.test.ts` (pinned digest vectors, corrupt/truncated reject).
   Neighbours also pass: routes-dir (no test files under `src/app`),
   voice-native, voice-recorder-seam, voice-message component (23 + 10 tests).
5. **Wiring** — `apps/mobile/package.json` links `zilar-whistle`
   (`file:./modules/zilar-whistle`) plus `expo-modules-core ~57.0.19` and
   `zod ^4.6.5` (both were NOT resolvable from the app despite the spec's
   expectation — see deviation); `pnpm-lock.yaml` updated; `.gitignore` ignores
   `apps/mobile/modules/zilar-whistle/android/third_party/` (binaries fetched,
   never committed).

### Commands and real results

- `pnpm install`: ok (only pre-existing `@types/react-dom` unmet-peer warning).
- `pnpm format:check`: pass. `pnpm lint` (oxlint): pass. `pnpm typecheck`
  (turbo, 11 tasks): pass.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 whistle`: 4 files, 32 passed.
- `fetch-engine.sh`: downloads both files, `needle engine ready`; sha256 of
  both matches the spec pins. Gradle `:zilar-whistle:fetchNeedleEngine` from a
  missing state re-downloads both and succeeds; `onlyIf` skips it when present.
- Native build (scratch clone `~/personal-projects/galena-android-try`, same
  sources synced — worktree `android/` is gitignored so prebuild output could
  not live in the worktree): `:zilar-whistle:compileReleaseKotlin` BUILD
  SUCCESSFUL; `:zilar-whistle:configureCMakeRelWithDebInfo` +
  `:zilar-whistle:buildCMakeRelWithDebInfo` BUILD SUCCESSFUL;
  `:zilar-whistle:assembleRelease` BUILD SUCCESSFUL. `libzilar-whistle.so`
  (arm64-v8a, 1.4 MB) exports the 3 JNI entry points and all 8 `needle_*`
  symbols (llvm-nm verified); `libc++_shared.so` packaged alongside.
- `expo export` Android + iOS: both succeed; the Android sourcemap bundles the
  whistle screen, port, and all 7 module sources (10 whistle hits of 4233).
- `expo prebuild --platform android --no-install` + autolinking resolve list
  `zilar-whistle` with `expo.modules.whistle.ZilarWhistleModule` (probe-tested
  before building, and again with the real module).

### Deviations from the spec (all in Allowed files)

- **Allowed dependencies says "None", but two had to be added** (both to
  `apps/mobile/package.json`, lockfile updated): `expo-modules-core ~57.0.19`
  (the module's `requireOptionalNativeModule` import; not resolvable from the
  app — `tsc` error TS2307 before adding) and `zod ^4.6.5` (JSON-boundary
  validation is a spec MUST; mobile had no zod — `ais-api.ts` says so, and the
  pnpm store only carries the server/web copy). `expo-file-system` needed no
  entry (already a direct mobile dep); the module declares it in its own
  `package.json`. No other new hosts: only `huggingface.co`, one pinned model URL.
- **JS surface lives in the module's `src/`, re-exported lazily** through
  `src/lib/whistle-port.ts` instead of direct `index.ts` imports, so Vitest
  and iOS bundles never execute `expo-file-system`/`expo-modules-core`.
- **Kotlin sync functions could not use `: Boolean`/`: String` return-type
  syntax** (compiler error at 66:29/70:29); bodies without declared types.
- **Gradle fixes vs stock Expo templates**: removed the explicit
  `org.jetbrains.kotlin.android` plugin line (version conflict with the
  classpath plugin), added `versionCode/versionName` (autolinking requires
  them), dropped the `expo-modules-core:57.0.19` maven coordinate (unresolvable
  — the gradle plugin injects it as `compileOnly project`), JVM 17 to match
  the toolchain, and fixed the CMake `NEEDLE_DIR` depth
  (`src/main/cpp` → `android/third_party`) plus the fetch script path.
- **No test beside `dev/whistle.tsx`**: `routes-dir.test.ts` forbids test files
  under `src/app` (Metro would bundle vitest). Screen logic is covered through
  `whistle-port.test.ts`/`whistle-last-note` instead; the routes-dir test passes.

### How the non-Vitest parts were checked

- Kotlin/C++ cannot run in Vitest: compiled for real —
  `:zilar-whistle:compileReleaseKotlin`, CMake configure + native link, and
  `assembleRelease` all BUILD SUCCESSFUL on Java 17 + NDK 27.1.12297006 with
  `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`.
- `libneedle.a` verified AArch64 (`llvm-readelf`: ELF64 AArch64 relocatable)
  and exports `needle_load/models/last_error/transcribe` (`llvm-nm`).
- Checksum-failure path: script deletes the temp file and exits 1 on mismatch
  (read the code; did NOT run a live corrupt-fetch because Gradle's missing-file
  re-fetch overwrites fixtures — the JS-side corrupt/truncated rejects ARE
  tested in `whistle-checksum.test.ts`).
- No device/APK run: the lead builds the APK; dev-screen rendering was verified
  by typecheck + both platform bundles, not on a phone.

### Security checklist

- No secrets/tokens in code, logs, or error strings (only ids/URIs Durations).
- No server change; single new network host `huggingface.co`, one pinned URL.
- Model write is temp-then-rename; checksum verified before use; partials removed.
- Transcription is local-only; nothing leaves the device.

### Blocked / needs a decision

- None blocking. Two follow-ups for the lead: (1) confirm the two added deps
  (`expo-modules-core`, `zod` in `apps/mobile/package.json`) are acceptable
  despite "Allowed dependencies: None"; (2) run the APK on an arm64 phone —
  expected first-run numbers (model load ms, ttft, tok/s) are shown by the dev
  screen but no real transcription has executed yet (no device here).

## Review (written by Claude)
