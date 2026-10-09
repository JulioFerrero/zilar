---
id: T-0746
title: "follow-ups from the 10-09 deploy: ensureWritableDir's default 'created' warning names STICKER_STORAGE_DIR for every dir (use envName); the voice pipeline timeout test waits 20 s of real time because TestClock never reaches fetchAndTranscribe's own runPromise (drive the Effect form instead)"
status: todo
milestone: M5
branch: task/T-0746-startup-label-voice-clock
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0746: the startup log label and the voice test clock

## Spec (written by Claude, do not edit)

### Why
These are two small bugs the lead found during the 2026-10-09 deploy of `748bbae7`:
1. **The startup log mislabels directories.** The live server logged `STICKER_STORAGE_DIR did not exist; created /app/data/backgrounds`: the message names the wrong variable.
2. **One voice test waits on the real clock.** `voice-transcription/pipeline.test.ts` › "a fetch that never starts…" takes 20,011 ms in CI (run 37890484924) and times out under the local 5 s limit, so the full local suite is red.

### Verified facts (do not re-derive)
- **`apps/server/src/startup.ts`:**
  - `defaultDeps()` (lines 24-33) hard-codes `onCreated: (dir) => console.warn(\`STICKER_STORAGE_DIR did not exist; created ${dir}\`)`;
  - `ensureWritableDir(dir, envName, deps = defaultDeps())` (lines 36-40) already receives `envName`;
  - `apps/server/src/index.ts:103,113,117` calls it for `STICKER_STORAGE_DIR`, `AVATAR_STORAGE_DIR` and `BACKGROUND_STORAGE_DIR`;
  - `apps/server/src/startup.test.ts` passes its own `onCreated` (lines 20-33).
- **`apps/server/src/voice-transcription/pipeline.ts`:**
  - `fetchAndTranscribe(input)` (lines 220-232) calls `Effect.runPromise(fetchAndTranscribeEffect(input)…)`, which uses its own default clock;
  - `fetchAndTranscribeEffect` (line 192) is not exported;
  - `VOICE_FETCH_TIMEOUT_MS = 20_000` (line 25).
- **The slow test** (`pipeline.test.ts:187-213`) wraps `Effect.promise(() => fetchAndTranscribe(...))` and adjusts a `TestClock`. That clock cannot reach the inner `runPromise`, so the real 20 s timeout fires.

### What to build
1. **`startup.ts`:**
   - `defaultDeps(envName)` uses `envName` in the message: `${envName} did not exist; created ${dir}`;
   - `ensureWritableDir` passes it as `deps = defaultDeps(envName)`;
   - add one test in `startup.test.ts` that calls `ensureWritableDir` without custom deps on a new temp dir, with `console.warn` spied, and asserts the message names the given `envName`.
2. **`pipeline.ts`:**
   - export the Effect form as `fetchAndTranscribeAsEffect`, which is `fetchAndTranscribeEffect` piped through the same `catchTags` mapping to `HttpError` that `fetchAndTranscribe` uses;
   - `fetchAndTranscribe` becomes `Effect.runPromise(fetchAndTranscribeAsEffect(input))`;
   - behaviour is unchanged.
3. **`pipeline.test.ts:187-213`:** fork `fetchAndTranscribeAsEffect(...)` itself under `TestClock.layer()`, adjust the clock by `VOICE_FETCH_TIMEOUT_MS + 1`, and assert the same `HttpError` 502 `audio_unavailable` from the failure (for example with `Fiber.join` plus `Effect.flip`). The test must finish in well under 1 s.

### Read first
`AGENTS.md`, `apps/server/src/startup.ts`, `apps/server/src/startup.test.ts` (lines 1-60), `apps/server/src/voice-transcription/pipeline.ts` (lines 1-60 and 185-235), `apps/server/src/voice-transcription/pipeline.test.ts` (lines 1-50 and 180-214), `docs/EFFECT_GUIDE.md` (section "How to test").

### Allowed files
`apps/server/src/startup.ts`, `apps/server/src/startup.test.ts`, `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/voice-transcription/pipeline.test.ts`, `work/T-0746-startup-label-voice-clock.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/startup.test src/voice-transcription
pnpm gate
```

### Acceptance
- `src/voice-transcription/pipeline.test.ts` passes under the default 5 s timeout, and the changed test takes under 1 s.
- The new startup test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
