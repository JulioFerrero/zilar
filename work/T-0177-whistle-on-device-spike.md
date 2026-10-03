---
id: T-0177
title: Spike: transcribe voice notes on the phone with Cactus Whistle (Android, local Expo module)
status: planned
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

## Review (written by Claude)
