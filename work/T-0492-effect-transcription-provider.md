---
id: T-0492
title: "Effect convert: voice transcription provider call (timeout, unreachable vs rejected) in Effect, Promise API unchanged"
status: todo
milestone: M5
branch: task/T-0492-effect-transcription-provider
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.2 day
---

# T-0492: the transcription provider in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "all the codebase to be effect 4.0", "nothing of new features". The T-0173 spike converted the voice-transcription pipeline but left the provider call as plain async code. This task converts it under the rules of `docs/EFFECT_GUIDE.md`:
- Effect inside, Promise exports at the edge;
- **behaviour stays the same, and existing tests pass unchanged**.

zod stays here for now; the Effect Schema switch comes from the T-0490 plan.

### Verified facts (do not re-derive)
- **The file:** `apps/server/src/voice-transcription/provider.ts` (140 lines).
- **Exports:**
  - `TranscriptionResult`, `TranscribeInput`, `TranscriptionFailureKind` (`'unreachable' | 'rejected'`);
  - `class TranscriptionProviderError` (line 36);
  - `TranscriptionFetch`, `transcriptionEndpointFor` (line 53);
  - `transcribeAudio(input, fetchFn = defaultFetch)` (line 57);
  - `silentVerificationWav` (line 114).
- **`transcribeAudio`** (lines 57-100):
  1. an `AbortController` with a `setTimeout(PROVIDER_TIMEOUT_MS)` abort, cleared in `finally`;
  2. a bearer header only when `apiKey` is non-empty;
  3. a `FormData` with the model and the file;
  4. a fetch throw (transport, abort or DNS) → `TranscriptionProviderError('unreachable')`;
  5. `!response.ok` → `'rejected'`;
  6. the body is parsed with the zod `transcriptionResponseSchema`; a failure → `'rejected'`;
  7. it returns the trimmed `text` and `language ?? null`.
- **Importers:** `apps/server/src/voice-transcription/routes.ts` and `apps/server/src/voice-transcription/pipeline.ts`. **Tests:** `apps/server/src/voice-transcription/provider.test.ts`, plus `apps/server/src/voice-transcription/pipeline.test.ts` and `apps/server/src/voice-transcription/routes.test.ts`.
- **The reference:** `apps/server/src/voice-transcription/pipeline.ts` (same folder) and `docs/EFFECT_GUIDE.md`. Notes from T-0484:
  - `Effect.callback` is the callback constructor (there is no `Effect.async` in 4.0.0);
  - `Effect.timeoutOrElse` interrupts the source and keeps only the typed error;
  - `Effect.tryPromise` gives an `AbortSignal` that fires on interruption.

### What to build
1. **`transcribeAudio`'s body** becomes an `Effect.fnUntraced` generator:
   - the fetch through `Effect.tryPromise`, passing its signal to `fetchFn`;
   - the timeout through `Effect.timeoutOrElse(PROVIDER_TIMEOUT_MS)`, which maps to `unreachable`;
   - typed internal errors for unreachable and rejected.
   
   At the Promise edge it throws exactly today's `TranscriptionProviderError(kind)`.
2. **Exports:** every export keeps its name, type and signature. `TranscriptionProviderError` stays an `Error` class.
3. **Tests:** the existing tests in all three files pass **unchanged**. You may add `apps/server/src/voice-transcription/provider.effect.test.ts`, for example: the timeout aborts the fetch signal and gives `unreachable`.
4. **Report:** give the line counts before and after.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/voice-transcription/provider.ts`, `apps/server/src/voice-transcription/provider.test.ts`.

### Allowed files
`apps/server/src/voice-transcription/provider.ts`, `apps/server/src/voice-transcription/provider.effect.test.ts`, `work/T-0492-effect-transcription-provider.md`.

**If an existing test must change, stop and report BLOCKED.**

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot voice-transcription
pnpm gate
```

### Acceptance
- `transcribeAudio` runs on Effect inside, with identical exports, errors and results.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)
