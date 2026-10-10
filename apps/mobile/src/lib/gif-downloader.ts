/**
 * The real GIF downloader seam (T-1021, split from `attachment-native.ts`):
 * fetches the picked result through the same-origin proxy into the cache dir
 * through `expo-file-system/legacy`.
 */

import { Effect, type Effect as EffectType } from 'effect';
import * as FileSystem from 'expo-file-system/legacy';

import { cleanFilename, MAX_ATTACHMENT_BYTES } from './attachments';
import type { GifDownloader, PickedFile } from './attachment-ports';
import { gifBlobType, gifFileName, isGifMediaType, isLoadableGifPreviewUrl } from './gifs';
import { API_URL } from './auth';
import { getSessionToken } from './session-token';
import { authHeadersFor, NativeFailure, orErrorResult } from './attachment-common';

export const GIF_DOWNLOAD_FAILED_MESSAGE = 'Could not load that GIF. Try another.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function headerMimeType(headers: Record<string, string>): string {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'content-type') {
      return value.split(';')[0]?.trim().toLowerCase() ?? '';
    }
  }
  return '';
}

type GifInput = Parameters<GifDownloader['download']>[0];
type GifResult = Awaited<ReturnType<GifDownloader['download']>>;

const downloadGifEffect = Effect.fnUntraced(function* (
  gif: GifInput,
  apiUrl: string,
  getToken: (() => Promise<string | undefined>) | undefined,
  download: typeof FileSystem.downloadAsync,
  getInfo: typeof FileSystem.getInfoAsync,
  cacheDir: string | null | undefined,
): EffectType.fn.Return<GifResult, NativeFailure> {
  if (!isLoadableGifPreviewUrl(gif.url, apiUrl)) {
    return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
  }
  const headers = yield* authHeadersFor(gif.url, apiUrl, getToken);
  if (cacheDir === null || cacheDir === undefined) {
    return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
  }
  const provisional = cleanFilename(`${gifFileName(gif.id, 'bin')}-${Date.now()}`);
  const result = yield* Effect.tryPromise({
    try: () =>
      download(
        gif.url,
        `${cacheDir}${provisional}`,
        headers === undefined ? undefined : { headers },
      ),
    catch: () => new NativeFailure({ message: GIF_DOWNLOAD_FAILED_MESSAGE }),
  });
  const contentType = isRecord(result) ? headerMimeType(result.headers ?? {}) : '';
  if (!isGifMediaType(contentType)) {
    return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
  }
  const { mime, extension } = gifBlobType(contentType, gif.kind);
  const size = typeof result.uri === 'string' ? yield* fileSize(result.uri, getInfo) : 0;
  if (size === 0) {
    return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return { status: 'error', message: 'That GIF is larger than 50 MB.' };
  }
  const file: PickedFile = {
    uri: result.uri,
    name: gifFileName(gif.id, extension),
    mimeType: mime,
    size,
  };
  if (gif.kind === 'image') {
    file.width = gif.width;
    file.height = gif.height;
  }
  return { status: 'downloaded', file };
});

/**
 * The real GIF downloader (T-0148): fetches the picked result through the
 * same-origin proxy into the cache dir, then reports it as a picked file so
 * the composer sends it through the normal attachment upload path (like
 * web's `sendGif`). The URL is re-checked against the proxy gate before any
 * fetch; the session bearer rides only to the API origin. The mime and the
 * extension come from the real content type (validated against what the
 * proxy serves), never from the search result's kind.
 */
export function createGifDownloader(options?: {
  apiUrl?: string | undefined;
  getToken?: (() => Promise<string | undefined>) | undefined;
  /** Tests inject a fake download; production uses the legacy file system. */
  download?: typeof FileSystem.downloadAsync | undefined;
  /** Tests inject a fake stat; production reads the downloaded file. */
  getInfo?: typeof FileSystem.getInfoAsync | undefined;
  cacheDir?: string | null | undefined;
}): GifDownloader {
  const apiUrl = options?.apiUrl ?? API_URL;
  const getToken = options?.getToken ?? getSessionToken;
  const download = options?.download ?? FileSystem.downloadAsync;
  const getInfo = options?.getInfo ?? FileSystem.getInfoAsync;
  return {
    download(gif: GifInput): Promise<GifResult> {
      const cacheDir = options?.cacheDir ?? FileSystem.cacheDirectory;
      return Effect.runPromise(
        orErrorResult(downloadGifEffect(gif, apiUrl, getToken, download, getInfo, cacheDir)),
      );
    },
  };
}

/** The byte size of a downloaded GIF; 0 when the stat fails or is not a file. */
const fileSize = (uri: string, getInfo: typeof FileSystem.getInfoAsync): Effect.Effect<number> =>
  Effect.tryPromise({ try: () => getInfo(uri), catch: () => undefined }).pipe(
    Effect.map((info) => (info.exists === true && info.isDirectory === false ? info.size : 0)),
    Effect.orElseSucceed((): number => 0),
    Effect.catchDefect(() => Effect.succeed(0)),
  );
