/**
 * The real native opener seam (T-1021, split from `attachment-native.ts`;
 * "open with the file type's app" from T-1319): downloads the attachment to
 * the cache directory and hands it to the app registered for its type.
 *
 * Android sends an `android.intent.action.VIEW` intent for the downloaded
 * file's `content://` URI through `expo-intent-launcher`, so the system opens
 * the PDF viewer (or asks "Open with" once) instead of showing the share
 * sheet. When no app handles the type the intent fails and we fall back to
 * React Native's built-in `Share`. iOS shows the in-app QuickLook preview
 * (`QLPreviewController`) through `react-native-file-viewer-turbo` (T-1321),
 * with the same `Share` fallback when the type is unsupported or the module
 * is missing from an older build.
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
 * MIME types for the extensions a chat realistically carries. The opener only
 * receives the attachment name (`AttachmentOpener.open` is `(url, name)`), so
 * the type is derived from the extension; anything unknown is
 * `application/octet-stream`, which the system resolves like a generic file.
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

/** The MIME type for a file name's extension; unknown types are generic. */
function mimeForFileName(name: string): string {
  const extension = name.toLowerCase().split('.').pop() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** The open error a user sees: the size cap's abort, or a generic failure. */
const openFailureOf = (error: unknown): NativeFailure =>
  error instanceof Error && error.name === 'AbortError'
    ? new NativeFailure({ message: TOO_LARGE_MESSAGE })
    : new NativeFailure({ message: OPEN_FAILED_MESSAGE });

/**
 * Downloads the attachment, then launches the app registered for its type.
 * Any failure in the content URI or the VIEW intent bubbles up so the caller
 * can fall back to the share sheet.
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
 * Shows the downloaded file in the in-app QuickLook preview (iOS, T-1321).
 * The module is imported lazily so an older build without the native module
 * throws here (and falls back to the share sheet) instead of at startup.
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
 * The real opener: downloads the attachment to the cache directory (with the
 * session bearer when it is our own API origin) and opens it with the type's
 * app. Nothing is fetched without a tap: the screen only calls this from a
 * press handler. The destination name is sanitized, so a peer-controlled
 * `../../x` name cannot escape the cache directory. The download is capped at
 * the attachment size limit (T-0157): the reported content length refuses up
 * front, and the progress callback aborts once the bytes pass the cap.
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
