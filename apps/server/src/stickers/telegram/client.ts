import { Cause, Effect, type Effect as EffectType } from 'effect';
import {
  TelegramFileTooLarge,
  TelegramImportError,
  TelegramInvalidPath,
  TelegramInvalidToken,
  TelegramPackNotFound,
  TelegramRateLimited,
  TelegramUnreachable,
  UNREACHABLE_MESSAGE,
  failureToImportError,
  scrubTokenText,
  type TelegramFailure,
} from './errors';
import { toStickerSet, type TelegramClient, type TelegramStickerSet } from './set';
import { botFileUrl, callMethodEffect, fetchCappedEffect, type FetchFn } from './transport';

/**
 * The real Telegram client: `fetch` only to the two hard-coded Telegram
 * URLs, no redirects, 10 s timeout, 1 MiB cap per file, 256 KiB cap per
 * method JSON envelope. Telegram's 429 (`retry_after`, capped at 5 s) is
 * retried once, then reported as `try_later`; an unknown bot token (401 on
 * any method) is `invalid_token` so the integrations page can verify a
 * pasted key; a missing pack is `pack_not_found`; no other Telegram text is
 * passed through.
 */
export function createTelegramClient(token: string, fetchFn: FetchFn = fetch): TelegramClient {
  // The `Promise` edge: map each internal failure to its fixed
  // `TelegramImportError`. The message is scrubbed defensively: the mapping
  // is fixed strings, but a future edit must not be able to leak the token.
  const toImportError = (failure: TelegramFailure): TelegramImportError => {
    const info = failureToImportError(failure);
    return new TelegramImportError(info.code, scrubTokenText(token, info.message));
  };

  const runClient = <A>(effect: EffectType.Effect<A, TelegramFailure>): Promise<A> =>
    Effect.runPromise(
      effect.pipe(
        Effect.catchTags({
          TelegramUnreachable: (error: TelegramUnreachable) => Effect.fail(toImportError(error)),
          TelegramRateLimited: (error: TelegramRateLimited) => Effect.fail(toImportError(error)),
          TelegramPackNotFound: (error: TelegramPackNotFound) => Effect.fail(toImportError(error)),
          TelegramInvalidToken: (error: TelegramInvalidToken) => Effect.fail(toImportError(error)),
          TelegramFileTooLarge: (error: TelegramFileTooLarge) => Effect.fail(toImportError(error)),
          TelegramInvalidPath: (error: TelegramInvalidPath) => Effect.fail(toImportError(error)),
        }),
        // The old `scrubbed()` catch-all: a defect must never escape as a
        // `FiberFailure` (which would carry the token-bearing URL). After
        // `catchTags` the only typed failures are the mapped
        // `TelegramImportError`s, so those pass through unchanged; every
        // other cause becomes the fixed `try_later`. Interruption belongs to
        // the caller and is rethrown unchanged.
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          if (Cause.squash(cause) instanceof TelegramImportError) {
            return Effect.failCause(cause);
          }
          return Effect.fail(
            new TelegramImportError('try_later', scrubTokenText(token, UNREACHABLE_MESSAGE)),
          );
        }),
      ),
    );

  return {
    // `getMe` verifies a bot token: a 401 is `invalid_token`, anything
    // else failing is `try_later`. Only the owner-gated integrations route
    // calls this; the import flow never needs it.
    getMe(): Promise<{ ok: boolean }> {
      return runClient(callMethodEffect(token, fetchFn, 'getMe', {}).pipe(Effect.as({ ok: true })));
    },

    getStickerSet(name: string): Promise<TelegramStickerSet> {
      return runClient(
        Effect.gen(function* () {
          const result = yield* callMethodEffect(token, fetchFn, 'getStickerSet', { name });
          return yield* Effect.try({
            try: () => toStickerSet(name, result),
            catch: (error) =>
              error instanceof TelegramPackNotFound ? error : new TelegramUnreachable(),
          });
        }),
      );
    },

    downloadFile(fileId: string): Promise<Uint8Array> {
      return runClient(
        Effect.gen(function* () {
          const info = (yield* callMethodEffect(token, fetchFn, 'getFile', {
            file_id: fileId,
          })) as Record<string, unknown> | null;
          const filePath =
            info !== null && typeof info === 'object' && typeof info.file_path === 'string'
              ? info.file_path
              : '';
          if (filePath === '' || filePath.includes('..')) {
            return yield* new TelegramInvalidPath();
          }
          const url = yield* Effect.try({
            try: () => botFileUrl(token, filePath),
            catch: () => new TelegramUnreachable(),
          });
          return yield* fetchCappedEffect(url, fetchFn, {});
        }),
      );
    },
  };
}
