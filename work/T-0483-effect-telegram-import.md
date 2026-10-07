---
id: T-0483
title: "Effect convert: Telegram sticker import client (fetch + timeout + one 429 retry) in Effect, Promise API unchanged"
status: todo
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

## Review (written by Claude)
