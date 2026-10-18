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

/** The real Telegram client: `fetch` only to the two hard-coded HTTPS URLs,
 * no redirects, 10 s timeout, 1 MiB per file and 256 KiB per method
 * envelope. A 429 retries once, then `try_later`; 401 is `invalid_token`; a
 * missing pack is `pack_not_found`; no other Telegram text passes through. */
export function createTelegramClient(token: string, fetchFn: FetchFn = fetch): TelegramClient {
  // The `Promise` edge maps each internal failure to its fixed
  // `TelegramImportError`; the message is scrubbed defensively.
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
        // A defect must never escape as a `FiberFailure` (which would carry the
        // token-bearing URL); after `catchTags` every other cause becomes the fixed
        // `try_later`, while interruption is rethrown unchanged.
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
    // `getMe` verifies a bot token: 401 is `invalid_token`, anything else
    // `try_later`. Only the owner-gated integrations route calls it.
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
