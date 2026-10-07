---
id: T-0483
title: "Effect convert: Telegram sticker import client (fetch + timeout + one 429 retry) in Effect, Promise API unchanged"
status: merged
milestone: M5
branch: task/T-0483-effect-telegram-import
model: auto
effort: low
depends_on: [T-0173]
estimate: 0.35 day
---

# T-0483: the Telegram import client in Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: "continue with the effect conversion, nothing of new features". This is a convert task from `docs/ROADMAP_EFFECT.md` (the candidate "Telegram sticker import"). It follows the rules there and in `docs/EFFECT_GUIDE.md`:
- Effect inside, plain `Promise` exports at the edge;
- zod stays;
- **behaviour stays the same, and existing tests pass unchanged**;
- no features.

### Verified facts (do not re-derive)
- **The file:** `apps/server/src/stickers/telegram-import.ts` (483 lines).
- **Exports:**
  - `TELEGRAM_API_HOST`, `TELEGRAM_IMPORT_TIMEOUT_MS` (10 s), `TELEGRAM_IMPORT_MAX_BYTES`, `TELEGRAM_JSON_MAX_BYTES`;
  - `TelegramImportErrorCode`, `class TelegramImportError` (line 31);
  - `parseTelegramPackInput` (line 50);
  - `TelegramStickerEntry`, `TelegramStickerSet`, `TelegramClient` (line 105);
  - `createTelegramClient(token, fetchFn = fetch)` (line 342).
- **The async logic to convert:**
  - `fetchCapped` (lines 142-200): an `AbortController` plus a `setTimeout` timeout, a manual redirect refusal, and a capped streaming read;
  - `callMethod` (lines 343-391): the same timeout pattern. A 429 with `retry_after` (capped at 5 s) waits, then makes exactly one more call through `callMethodOnce` (from line 395). Status mapping: 401 → `invalid_token`, 429 → `try_later`, 400 → `pack_not_found`;
  - errors are scrubbed (`scrubbed(error)`) so the bot token never leaks.
- **Importers:** `apps/server/src/stickers/routes.ts`, `apps/server/src/stickers/service.ts` and `apps/server/src/integrations/routes.ts`. They use the `TelegramClient` Promise methods and catch `TelegramImportError` by `code`.
- **Tests:** `apps/server/src/stickers/telegram-import.test.ts` and `apps/server/src/stickers/telegram-import-routes.test.ts`.
- **The reference conversion** is `apps/server/src/voice-transcription/pipeline.ts`. It uses `Effect.tryPromise`, `Effect.timeoutOrElse`, `Data.TaggedError`, `Effect.catchTags` and `Effect.runPromise` at the edge, plus the guide's notes (use `catchTag`/`catchTags`, not `Effect.catch`; there is no `timeoutFail` in v4).

### What to build
1. **Rewrite the internals of the file in Effect:**
   - the timeout through `Effect.timeoutOrElse` with an `AbortSignal` from `Effect.tryPromise`'s signal;
   - the single 429 retry as an explicit `Effect.sleep` then one more attempt (not a general retry schedule, so the behaviour stays exactly one retry);
   - typed internal errors, mapped to the same `TelegramImportError` codes and messages at the Promise edge.
2. **Every export keeps its name, type and Promise signature.** `TelegramImportError` stays a plain `Error` class, because importers check `instanceof` and `code`. Scrubbing stays: no token in any error or log.
3. **Tests:** the existing tests pass **unchanged**. You may add a new `apps/server/src/stickers/telegram-import.effect.test.ts` for anything the conversion adds (for example, a timeout aborts the fetch).
4. In the Report, give the line counts before and after, and note any Effect 4 surprise worth adding to the guide.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/effect-reference/LLMS.md`, `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/stickers/telegram-import.ts`, `apps/server/src/stickers/telegram-import.test.ts`.

### Allowed files
`apps/server/src/stickers/telegram-import.ts`, `apps/server/src/stickers/telegram-import.effect.test.ts`, `work/T-0483-effect-telegram-import.md`.

**If an existing test must change, stop and report BLOCKED:** a convert task never edits existing tests.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot stickers/telegram-import
pnpm gate
```

### Acceptance
- The Telegram client runs on Effect inside, with identical exports and behaviour.
- The existing tests are untouched and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Rewrote the internals of `apps/server/src/stickers/telegram-import.ts` on Effect:
- Added six internal `Data.TaggedError` failures (`TelegramUnreachable`,
  `TelegramRateLimited`, `TelegramPackNotFound`, `TelegramInvalidToken`,
  `TelegramFileTooLarge`, `TelegramInvalidPath`) and one `failureToImportError`
  table that maps each to the exact `TelegramImportError` code and message.
- `requestEffect` lifts the `fetch` through `Effect.tryPromise` (its `try`
  receives the runtime `AbortSignal`) plus a 10 s `AbortController` timer; the
  fetch receives `AbortSignal.any([effectSignal, timeoutSignal])`.
- `readDownloadBody` / `readEnvelopeBody` are lifted with `Effect.tryPromise`
  and throw the typed failures; the 1 MiB and 256 KiB caps and the redirect
  refusal are unchanged.
- `invokeEffect` keeps the exact status mapping (3xx/5xx -> `try_later`, 401 ->
  `invalid_token`, 429 with a positive capped `retry_after` -> a retry signal,
  429 -> rate limited, 400 -> `pack_not_found`); `callMethodEffect` performs
  exactly one `Effect.sleep(retryAfterMs)` and one more attempt.
- `createTelegramClient` keeps the same `TelegramClient` Promise methods; each
  runs `Effect.runPromise` with `Effect.catchTags` mapping the six failures to
  `TelegramImportError`. `TelegramImportError` stays a plain `Error` class and
  `scrubTokenText` still runs before every thrown message.

Exports are unchanged (`TELEGRAM_API_HOST`, `TELEGRAM_IMPORT_TIMEOUT_MS`,
`TELEGRAM_IMPORT_MAX_BYTES`, `TELEGRAM_JSON_MAX_BYTES`,
`TelegramImportErrorCode`, `TelegramImportError`, `parseTelegramPackInput`,
`TelegramStickerEntry`, `TelegramStickerSet`, `TelegramClient`,
`createTelegramClient`). `parseTelegramPackInput` and its helpers stay
synchronous and throw `TelegramImportError` unchanged.

### Deviation from the spec (please read)
Spec "What to build" #1 asked for the timeout through `Effect.timeoutOrElse`.
I implemented exactly that first, and the existing test
`telegram-import.test.ts > retries a 429 once ...` failed with
`expected 1 to be 2` (the first `fetch` was preempted, so no retry happened).
Cause: that test replaces `globalThis.setTimeout` with a mock that runs every
handler synchronously; Effect's Clock `sleep` uses `setTimeout`, so
`timeoutOrElse`'s race wins instantly and *interrupts* the fetch. The old code
also armed a 10 s `setTimeout`, but it only called `controller.abort()`, and the
mock fetch ignores its signal, so the response still arrived. `timeoutOrElse`
interrupts the effect itself, which the mock cannot ignore. Since this task
forbids changing existing tests, I kept the 10 s timeout as an `AbortController`
+ timer whose signal is combined with `Effect.tryPromise`'s signal (so an
interrupting effect still cancels the fetch). Behaviour is identical to the old
client: a stalled request is aborted, an answer that already arrived is never
preempted. The 429 retry is still `Effect.sleep` + one attempt. If you want the
literal `timeoutOrElse`, the test has to change (e.g. not run the handler
synchronously for the 10 s timer), which this task forbids.

### Files changed
- `apps/server/src/stickers/telegram-import.ts` (Allowed) — 483 -> 553 lines.
- `apps/server/src/stickers/telegram-import.effect.test.ts` (Allowed, new) —
  43 lines: one test proving the 10 s timeout aborts the `AbortSignal` handed
  to `fetch` and the request fails as `try_later`.
- `work/T-0483-effect-telegram-import.md` (Allowed) — status + this Report.

### Commands run
- `pnpm install` — done, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot stickers/telegram-import` —
  2 files, 37 tests passed (the two pre-existing test files are untouched).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot stickers/telegram-import.effect.test` —
  1 file, 1 test passed.
- `pnpm gate` (repo root) — first run FAILed format on
  `apps/server/src/stickers/telegram-import.ts`; formatted the two files with
  `pnpm exec prettier --write`; second run FAILed typecheck on a narrowing error
  in the new test (fixed). Final run:

  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (42.3s)
  PASS  lint  (1.1s)
  PASS  typecheck  (0.5s)
  PASS  tests @zilar/server  (1224.3s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Effect 4 surprise for the guide
`Effect.timeoutOrElse` preempts the losing effect by *interrupting* it, not by
aborting only its `AbortSignal`. A test that mocks `globalThis.setTimeout` to
run handlers synchronously therefore makes every `timeoutOrElse` fire
immediately, because Effect's `Clock` sleeps through `setTimeout`. When the
timed effect only reads the abort signal (as the old code did) that is
invisible, but under `timeoutOrElse` it is fatal. If a conversion keeps an old
signal-abort timeout, prefer a managed `AbortSignal.any([effectSignal,
timerSignal])` over `timeoutOrElse`.

### Open questions
- Is the `timeoutOrElse` -> managed `AbortController` deviation acceptable, or
  should the existing test be relaxed (out of scope for this task)?

### Round 2 (fix finding 2) — PREREVIEW.md
- `runClient` now ends with an edge `Effect.catchCause` (Effect 4 has no
  `catchAll`). A pure interruption (`Cause.hasInterruptsOnly`) is rethrown with
  `Effect.failCause`; a cause whose squashed value is already a mapped
  `TelegramImportError` (from `catchTags`) is rethrown unchanged; everything
  else — any defect — becomes
  `new TelegramImportError('try_later', scrubTokenText(token, UNREACHABLE_MESSAGE))`,
  like the old `scrubbed()`. This keeps a token-bearing URL/rejection out of a
  `FiberFailure`.
- Added a test in `telegram-import.effect.test.ts`: a `fetchFn` returns a 3xx
  object whose `arrayBuffer` throws the non-Error `'unexpected-non-error'`, so
  `discardBody` dies. The client reports `code === 'try_later'`, the fixed
  message, and no token. I confirmed the test fails without the catch-all (it
  saw the raw `'unexpected-non-error'` defect), so it really exercises the new
  branch.
- My first cut of the catch-all remapped the already-mapped
  `TelegramImportError`s and broke three existing tests (`400 -> pack_not_found`,
  `401 -> invalid_token`, `file_too_large`); fixed by passing mapped
  `TelegramImportError` causes through untouched.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  stickers/telegram-import.test stickers/telegram-import.effect.test` — 2 files,
  17 passed.
- `pnpm gate`:

  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (5.9s)
  PASS  format  (72.1s)
  PASS  lint  (1.8s)
  PASS  typecheck  (42.8s)
  PASS  tests @zilar/server  (1298.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

## Review (written by Claude)

Approved (lead, 2026-10-07). The Telegram client runs on Effect: capped fetch, a single 429 retry with Effect.sleep, and the same codes and messages. The lead fix round added an edge catchCause, so any unmapped failure or defect becomes try_later and the bot token cannot leave the module (tested). The existing tests are untouched.
