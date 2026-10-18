/**
 * Android opens the file with a VIEW intent and falls back to `Share` when no app handles the type; iOS shows QuickLook when `react-native-file-viewer-turbo` is in the build, else `Share`.
 */

import { Effect, type Effect as EffectType } from 'effect';
import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform, Share } from 'react-native';

import { cleanFilename, MAX_ATTACHMENT_BYTES } from './attachments';
import type { AttachmentOpener } from './attachment-ports';
import {
  authHeadersFor,
  NativeFailure,
  OPEN_FAILED_MESSAGE,
  orErrorResult,
  TOO_LARGE_MESSAGE,
} from './attachment-common';

/** `Intent.FLAG_GRANT_READ_URI_PERMISSION`: grants the viewer read access. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** `Intent.ACTION_VIEW` (expo-intent-launcher's enum has no constant). */
const ACTION_VIEW = 'android.intent.action.VIEW';

/**
 * `open` gets only `(url, name)`, so the type comes from the extension; anything unknown is `application/octet-stream`.
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  gz: 'application/gzip',
  tar: 'application/x-tar',
};

function mimeForFileName(name: string): string {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

const openFailureOf = (error: unknown): NativeFailure =>
  error instanceof Error && error.name === 'AbortError'
    ? new NativeFailure({ message: TOO_LARGE_MESSAGE })
    : new NativeFailure({ message: OPEN_FAILED_MESSAGE });

/**
 * Any failure bubbles up so the caller can fall back to the share sheet.
 */
const openOnAndroid = Effect.fnUntraced(function* (file: File, name: string) {
  const contentUri = yield* Effect.tryPromise({
    try: () => getContentUriAsync(file.uri),
    catch: (error: unknown) => error,
  });
  yield* Effect.tryPromise({
    try: () =>
      IntentLauncher.startActivityAsync(ACTION_VIEW, {
        data: contentUri,
        type: mimeForFileName(name),
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      }),
    catch: (error: unknown) => error,
  });
});

/**
 * Lazily imported: an older build without the module throws here and falls back, instead of at startup.
 */
const openInQuickLook = Effect.fnUntraced(function* (file: File, name: string) {
  const { open } = yield* Effect.tryPromise({
    try: () => import('react-native-file-viewer-turbo'),
    catch: (error: unknown) => error,
  });
  yield* Effect.tryPromise({
    try: () => open(file.uri, { displayName: cleanFilename(name) }),
    catch: (error: unknown) => error,
  });
});

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
  if (Platform.OS === 'ios') {
    const opened = yield* openInQuickLook(file, name).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (opened) {
      return { status: 'opened' };
    }
  }
  if (Platform.OS === 'android') {
    const opened = yield* openOnAndroid(file, name).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (opened) {
      return { status: 'opened' };
    }
  }
  yield* Effect.tryPromise({
    try: () => Share.share({ url: file.uri, title: cleanFilename(name) }),
    catch: (error: unknown) => error,
  });
  return { status: 'opened' };
});

/**
 * Nothing is fetched without a tap; the destination name is sanitized, so a peer-controlled `../../x` cannot escape the cache directory, and the download aborts once the bytes pass the size cap.
 */
export function createAttachmentOpener(options?: {
  apiUrl?: string | undefined;
  getToken?: (() => Promise<string | undefined>) | undefined;
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

export function cacheDestinationFor(name: string): string {
  return cleanFilename(name);
}
