/**
 * The real native opener seam (T-1021, split from `attachment-native.ts`):
 * downloads the attachment to the cache directory and opens the system
 * share/open sheet through React Native's built-in `Share`.
 */

import { Effect, type Effect as EffectType } from 'effect';
import { File, Paths } from 'expo-file-system';
import { Share } from 'react-native';

import { cleanFilename, MAX_ATTACHMENT_BYTES } from './attachments';
import type { AttachmentOpener } from './attachment-ports';
import {
  authHeadersFor,
  NativeFailure,
  OPEN_FAILED_MESSAGE,
  orErrorResult,
  TOO_LARGE_MESSAGE,
} from './attachment-common';

/** The open error a user sees: the size cap's abort, or a generic failure. */
const openFailureOf = (error: unknown): NativeFailure =>
  error instanceof Error && error.name === 'AbortError'
    ? new NativeFailure({ message: TOO_LARGE_MESSAGE })
    : new NativeFailure({ message: OPEN_FAILED_MESSAGE });

const openEffect = Effect.fnUntraced(function* (
  url: string,
  name: string,
  apiUrl: string | undefined,
  getToken: (() => Promise<string | undefined>) | undefined,
  download: typeof File.downloadFileAsync,
): EffectType.fn.Return<{ status: 'opened' }, unknown> {
  const headers = yield* authHeadersFor(url, apiUrl, getToken);
  const destination = yield* Effect.try({
    try: () => new File(Paths.cache, cleanFilename(name)),
    catch: (error: unknown) => error,
  });
  const controller = new AbortController();
  const file = yield* Effect.tryPromise({
    try: () =>
      download(url, destination, {
        idempotent: true,
        ...(headers === undefined ? {} : { headers }),
        signal: controller.signal,
        onProgress: (progress) => {
          const written = progress.bytesWritten;
          const total = progress.totalBytes;
          if (total > MAX_ATTACHMENT_BYTES || written > MAX_ATTACHMENT_BYTES) {
            controller.abort();
          }
        },
      }),
    catch: (error: unknown) => error,
  });
  yield* Effect.tryPromise({
    try: () => Share.share({ url: file.uri, title: cleanFilename(name) }),
    catch: (error: unknown) => error,
  });
  return { status: 'opened' };
});

/**
 * The real opener: downloads the attachment to the cache directory (with the
 * session bearer when it is our own API origin) and opens the system
 * share/open sheet. Nothing is fetched without a tap: the screen only calls
 * this from a press handler. The destination name is sanitized, so a
 * peer-controlled `../../x` name cannot escape the cache directory. The
 * download is capped at the attachment size limit (T-0157): the reported
 * content length refuses up front, and the progress callback aborts once the
 * bytes pass the cap.
 */
export function createAttachmentOpener(options?: {
  apiUrl?: string | undefined;
  getToken?: (() => Promise<string | undefined>) | undefined;
  /** Tests inject a fake download; production uses the new file system. */
  download?: typeof File.downloadFileAsync | undefined;
}): AttachmentOpener {
  const download = options?.download ?? File.downloadFileAsync;
  return {
    open(
      url: string,
      name: string,
    ): Promise<{ status: 'opened' } | { status: 'error'; message: string }> {
      return Effect.runPromise(
        orErrorResult(
          openEffect(url, name, options?.apiUrl, options?.getToken, download).pipe(
            Effect.mapError(openFailureOf),
          ),
        ),
      );
    },
  };
}

/** The sanitized cache destination for an attachment name (test seam). */
export function cacheDestinationFor(name: string): string {
  return cleanFilename(name);
}
