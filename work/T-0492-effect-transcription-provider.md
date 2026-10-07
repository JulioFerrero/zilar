---
id: T-0492
title: "Effect convert: voice transcription provider call (timeout, unreachable vs rejected) in Effect, Promise API unchanged"
status: merged
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

### What I did
Converted `transcribeAudio`'s body in `apps/server/src/voice-transcription/provider.ts` to Effect, keeping the Promise export at the edge and every export's name, type and signature.

- `transcribeAudio` is now `Effect.runPromise(transcribeAudioEffect(...).pipe(Effect.catchTags({...})))`. It still returns `Promise<TranscriptionResult>` and still rejects with `new TranscriptionProviderError(kind)` (same `name`, `kind` and default message).
- The call runs in an `Effect.fnUntraced` generator: it builds the headers and `FormData` exactly as before, runs the fetch through `Effect.tryPromise` (whose `try` receives the interruption `AbortSignal`, now passed to `fetchFn` in place of the old hand-made `AbortController`), and wraps it in `Effect.timeoutOrElse({ duration: Duration.millis(PROVIDER_TIMEOUT_MS), orElse: () => Effect.fail(new ProviderUnreachable()) })`. The timeout interrupts the fetch (aborting the signal) and maps to `unreachable`, with no `Cause.TimeoutError` in the channel.
- Two non-exported `Data.TaggedError` classes model the internal failures: `ProviderUnreachable` (transport, DNS or timeout) and `ProviderRejected` (non-OK response, or a body that fails the zod schema). `catchTags` at the edge maps them to the old `TranscriptionProviderError('unreachable' | 'rejected')`.
- The body read stays `response.json().catch(() => null)` lifted with `Effect.promise`; the `!response.ok` check and the zod parse keep their old order, so `rejected` is unchanged. Empty text still trims to `''`, and a missing language still becomes `null`.
- Added `provider.effect.test.ts`: one test proves the fetch receives an `AbortSignal`, and one drives the real 60 s timeout with fake timers and asserts the fetch signal is aborted and the result is `unreachable`.
- `provider.test.ts`, `pipeline.test.ts` and `routes.test.ts` are untouched.

### Files changed
- `apps/server/src/voice-transcription/provider.ts` (140 → 164 lines)
- `apps/server/src/voice-transcription/provider.effect.test.ts` (new, 57 lines)
- `work/T-0492-effect-transcription-provider.md` (status + this Report)

### Commands and results
- `pnpm install` → done, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot voice-transcription/provider.test.ts` → 1 file, **5 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot voice-transcription/pipeline.test.ts` → 1 file, **8 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot voice-transcription/provider.effect.test.ts` → 1 file, **2 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot voice-transcription` (the task's Checks command) → 4 files, **40 passed**.
- `pnpm gate` (repo root) → exit 0:

  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (6.9s)
  PASS  format  (44.1s)
  PASS  lint  (1.4s)
  PASS  typecheck  (0.9s)
  PASS  tests @zilar/server  (1255.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

  (The `tests @zilar/server` step ran the branch's changed tests via `--changed main`; the task's own voice-transcription run above is the 4-file / 40-test result. The long duration is machine load from the other worktrees, not a failing test.)

### Deviations / notes
- The old code created its own `AbortController` + `setTimeout`. That timer moved to `Effect.timeoutOrElse`; the signal now comes from `Effect.tryPromise`. Behaviour is the same: a hung fetch is aborted at 60 s and reports `unreachable`.
- The `json()` body read was never covered by the old abort timer (the timer only aborted the fetch signal), so it stays outside the timeout, preserving behaviour.
- No new dependencies; zod stays for the response shape.

### Open questions
- None.

## Review (written by Claude)

Approved (lead, 2026-10-07). transcribeAudio runs on Effect: tryPromise passes its signal to fetchFn, timeoutOrElse maps to unreachable, and the typed errors are mapped to the same TranscriptionProviderError at the edge. The existing tests in all three files are untouched. Pre-review clean.
