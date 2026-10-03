---
id: T-0178
title: Whistle module: cut long voice notes at real quiet moments (amplitude envelope from the native decoder)
status: planned
milestone: M5
branch: task/T-0178-whistle-quiet-cut-chunks
model: meta/muse-spark-1.3-contributor
effort: low
depends_on: [T-0177]
estimate: 0.5 day
---

# T-0178: Quiet-point chunking for Whistle

## Spec (written by Claude, do not edit)

### Why
Whistle transcribes at most 30 s at a time, so a long voice note is cut into chunks of at most 28 s. Today the cuts fall on fixed 28 s boundaries because the JS planner `planQuietCutChunks` is called with a fake amplitude function (`() => 1`, in `planRangesMs`, `apps/mobile/modules/zilar-whistle/src/transcribe.ts`). A word can be split at the boundary. Julio's 2-minute phone test (2026-10-03) was about 80-90% right; this makes the cuts land in pauses.

### Verified facts (do not re-derive)
- `planQuietCutChunks(totalSamples, amplitudes)` lives in `modules/zilar-whistle/src/chunks.ts`, is tested, and takes `amplitudes: (sampleIndex: number) => number` (absolute amplitude at a 16 kHz sample index). It searches `WHISTLE_CUT_SEARCH_SAMPLES` before each 28 s limit for the quietest point.
- `planRangesMs(options)` in `transcribe.ts` calls it with `options?.amplitudes ?? (() => 1)`, and returns `null` for clips of 28 s or less.
- The native decode is `decodeToMono16k(path)` in `android/src/main/java/expo/modules/whistle/ZilarWhistleModule.kt`; it returns mono 16 kHz samples. The native module already has `AsyncFunction("transcribeRanges")` taking `(path, rangesMs, language)`.
- Hermes has no `crypto.subtle`; Expo modules cannot take a `Promise` parameter inside a `Coroutine` function (that broke T-0177 once). Use plain `AsyncFunction("name") { args -> value }` returning a value, no Promise parameter.

### What to build
1. **Native**: add `AsyncFunction("amplitudeEnvelope") { path: String -> ... }` in `ZilarWhistleModule.kt`. It runs `decodeToMono16k(localPath(path))` and returns a `List<Double>` with one value per 10 ms window (160 samples): the mean absolute amplitude of that window, 0.0..1.0. Same ABI check as the other functions (throw `CodedException("unavailable", ...)` when not arm64). A silent clip returns all zeros. Cap the result at 60 000 entries (10 minutes), matching the existing 10-minute decode bound.
2. **JS**: declare `amplitudeEnvelope: (path: string) => Promise<number[]>` in `ZilarWhistleNativeModule` (`src/ZilarWhistleModule.ts`). In `transcribe.ts`, when `audioMs > 28_000` and the caller gave no `amplitudes`, fetch the envelope first and build `amplitudes = (sample) => envelope[Math.floor(sample / 160)] ?? 0`, then plan with it. A failure of `amplitudeEnvelope` falls back to the even windows (never fails the transcription).
3. **Tests (Vitest)** in the existing whistle test files (`apps/mobile/src/lib/whistle-*.test.ts`): (a) with a fake native module whose envelope has a silent gap at 25.0-25.5 s of a 60 s clip, the planned ranges contain a cut inside that gap (not at 28 000 ms); (b) when the envelope call rejects, the ranges are the even windows and the transcription still runs; (c) clips of 28 s or less never call `amplitudeEnvelope`. Mutation-check (a): restore `() => 1` and see it fail.

### Read first
`AGENTS.md`, `apps/mobile/modules/zilar-whistle/README.md`, `src/transcribe.ts`, `src/chunks.ts`, `src/ZilarWhistleModule.ts`, `ZilarWhistleModule.kt` (the `decodeToMono16k` and `localPath` helpers), `apps/mobile/src/lib/whistle-chunks.test.ts`, `whistle-native.test.ts`.

### Allowed files
`apps/mobile/modules/zilar-whistle/**` (not `scripts/`), `apps/mobile/src/lib/whistle-*.ts` and `whistle-*.test.ts`.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/mobile test --maxWorkers=2 whistle
```
You cannot compile Kotlin in this task's checks; say so in the Report. The lead builds the APK and tests on the emulator and the phone.

### Acceptance
- Long clips are planned with real amplitudes; a quiet gap near a limit is chosen over the fixed boundary.
- An envelope failure never breaks transcription.
- No new dependency, no `any`, no unrelated file touched.

### Out of scope
The voice bubble UI (T-0179), iOS, overlapping chunks, word timestamps.

---

## Report (written by the worker when done)

## Review (written by Claude)
