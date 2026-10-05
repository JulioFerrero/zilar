# zilar-whistle

A local Expo module (T-0177): on-device speech-to-text for Zilar voice notes
with the Cactus Whistle model through the Needle engine. Android arm64-v8a
only; on any other ABI or on iOS the module reports `unavailable`.

## Licence

- Whistle model (`whistle.cact`): Apache-2.0, Cactus Compute
  (`https://huggingface.co/Cactus-Compute/whistle`).
- Needle engine (`libneedle.a`, `needle.h`): Apache-2.0, Cactus Compute
  (`https://huggingface.co/Cactus-Compute/needle3`). Fetched at build time,
  never committed (see `android/third_party/needle/.gitignore`).

## Layout

- `src/` — the JS surface: `isAvailable`, `modelStatus`, `downloadModel`,
  `transcribe`, plus the pinned model URL/checksum and the zod-validated
  result parsing.
- `android/` — the Expo module: Kotlin (`ZilarWhistleModule.kt`), a small C++
  JNI shim (`src/main/cpp/whistle-jni.cpp`, `CMakeLists.txt` linking
  `libneedle.a` and the NDK `c++_shared`), and `build.gradle` which fetches
  the engine before the native build when it is missing.
- `scripts/fetch-engine.sh` — downloads `libneedle.a` + `needle.h` at the
  pinned revision and verifies both sha256 checksums, failing loudly on a
  mismatch.

## JS surface

- `isAvailable(): boolean` — true only on Android arm64 with the module linked.
- `modelStatus(): Promise<'missing' | 'ready'>`
- `downloadModel(onProgress?): Promise<void>` — downloads `whistle.cact`
  from the pinned Hugging Face URL into the app files dir, verifies the
  sha256, writes to a temp name and renames. Never leaves a partial file;
  safe to call twice.
- `transcribe(fileUri, { language? }): Promise<{ text, language, ttftMs, decodeTps, audioMs, wallMs }>`
  — decodes m4a/AAC or wav to 16 kHz mono, splits audio over 30 s into
  quiet-cut chunks of at most 28 s, joins texts with a single space. One
  transcription at a time; a second call waits. Empty/silent audio gives an
  empty text.

## Native notes

- The engine keeps the model bytes passed to `needle_load`: the JNI shim
  mallocs the `.cact` buffer and never frees it.
- The engine is one process-global, non-thread-safe model: the Kotlin side
  serialises loads and transcriptions on one lock.
