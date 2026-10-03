/**
 * The real native attachment seams (T-0150): `expo-image-picker` for photos,
 * videos and the camera, `expo-document-picker` for generic files,
 * `expo-file-system` for the XEP-0363 PUT, and React Native's built-in
 * `Share` for opening downloaded files. Only imported by the chat screen
 * (and tests through the port interfaces), so Vitest never loads the
 * native modules uninvoked.
 */

import * as DocumentPicker from 'expo-document-picker';
import { File, Paths, UploadType } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Share } from 'react-native';

import { cleanFilename, extensionForMime, MAX_ATTACHMENT_BYTES, mimeForAsset } from './attachments';
import type {
  AttachmentOpener,
  AttachmentPicker,
  AttachmentUploader,
  GifDownloader,
  PickedFile,
  PickResult,
} from './attachment-ports';
import { gifBlobType, gifFileName, isGifMediaType, isLoadableGifPreviewUrl } from './gifs';
import { API_URL } from './auth';
import { getSessionToken } from './session-token';

export type { PickedFile, PickResult } from './attachment-ports';

const TOO_LARGE_MESSAGE = 'That file is larger than 50 MB.';
const EMPTY_MESSAGE = 'That file is empty.';
const DENIED_MESSAGE =
  'Zilar needs access to your photos to attach them. You can allow it in Settings.';
const CAMERA_DENIED_MESSAGE =
  'Zilar needs access to your camera to take a photo. You can allow it in Settings.';
const PICK_FAILED_MESSAGE = 'Could not pick that file. Try again.';
const OPEN_FAILED_MESSAGE = 'Could not open that file. Try again.';

function tooLarge(size: number | undefined): boolean {
  return size !== undefined && size > MAX_ATTACHMENT_BYTES;
}

function pickedFile(input: {
  uri: string;
  name: string | null | undefined;
  mimeType: string | undefined;
  size: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** Real byte size read from the file when the picker reported none. */
  measuredSize?: number | undefined;
}): PickResult {
  // An unknown picker size is not an empty file: only a real zero refuses.
  // The picker reads the size from the file first (see `createAttachmentPicker`
  // below); `measuredSize` is that stat when the picker reported nothing.
  const size = input.size ?? input.measuredSize;
  if (size !== undefined && size === 0) {
    return { status: 'error', message: EMPTY_MESSAGE };
  }
  if (tooLarge(size)) {
    return { status: 'error', message: TOO_LARGE_MESSAGE };
  }
  const mime = mimeForAsset(input.mimeType);
  const fallbackName = `photo.${extensionForMime(mime)}`;
  const file: PickedFile = {
    uri: input.uri,
    name: input.name ?? fallbackName,
    mimeType: mime,
    size: size ?? 0,
  };
  if (input.width !== undefined && input.height !== undefined) {
    file.width = input.width;
    file.height = input.height;
  }
  return { status: 'picked', file };
}

/** The real picker: library (photo or video), camera, and generic files. */
export function createAttachmentPicker(sizeReader?: SizeReader): AttachmentPicker {
  const reader = sizeReader;
  // An unknown picker size is read from the file before the cap check: only
  // a real zero says "That file is empty".
  async function withRealSize(input: {
    uri: string;
    name: string | null | undefined;
    mimeType: string | undefined;
    size: number | undefined;
    width?: number | undefined;
    height?: number | undefined;
  }): Promise<PickResult> {
    if (input.size !== undefined || reader === undefined) {
      return pickedFile(input);
    }
    return pickedFile({ ...input, measuredSize: await reader.sizeOf(input.uri) });
  }
  return {
    async pickImageOrVideo(): Promise<PickResult> {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        return { status: 'error', message: DENIED_MESSAGE };
      }
      let result: ImagePicker.ImagePickerResult;
      try {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          quality: 1,
        });
      } catch {
        return { status: 'error', message: PICK_FAILED_MESSAGE };
      }
      if (result.canceled) {
        return { status: 'cancelled' };
      }
      const asset = result.assets[0];
      if (asset === undefined) {
        return { status: 'cancelled' };
      }
      const mime = asset.mimeType ?? (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
      const name =
        asset.fileName ?? `photo.${extensionForMime(mime === undefined ? undefined : mime)}`;
      return withRealSize({
        uri: asset.uri,
        name,
        mimeType: mime,
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
      });
    },

    async takePhoto(): Promise<PickResult> {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        return { status: 'error', message: CAMERA_DENIED_MESSAGE };
      }
      let result: ImagePicker.ImagePickerResult;
      try {
        result = await ImagePicker.launchCameraAsync({ quality: 1 });
      } catch {
        return { status: 'error', message: PICK_FAILED_MESSAGE };
      }
      if (result.canceled) {
        return { status: 'cancelled' };
      }
      const asset = result.assets[0];
      if (asset === undefined) {
        return { status: 'cancelled' };
      }
      const mime = asset.mimeType ?? 'image/jpeg';
      const name = asset.fileName ?? `photo.${extensionForMime(mime)}`;
      return withRealSize({
        uri: asset.uri,
        name,
        mimeType: mime,
        size: asset.fileSize,
        width: asset.width,
        height: asset.height,
      });
    },

    async pickFile(): Promise<PickResult> {
      let result: DocumentPicker.DocumentPickerResult;
      try {
        result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      } catch {
        return { status: 'error', message: PICK_FAILED_MESSAGE };
      }
      if (result.canceled) {
        return { status: 'cancelled' };
      }
      const asset = result.assets[0];
      if (asset === undefined) {
        return { status: 'cancelled' };
      }
      return withRealSize({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      });
    },
  };
}

/** Resolves the real byte size of a local file, or undefined when unknown. */
export interface SizeReader {
  sizeOf(uri: string): Promise<number | undefined>;
}

/** The real size reader: `expo-file-system` stat of the picked file. */
export function createSizeReader(
  getInfo: typeof FileSystem.getInfoAsync = FileSystem.getInfoAsync,
): SizeReader {
  return {
    async sizeOf(uri: string): Promise<number | undefined> {
      try {
        const info = await getInfo(uri);
        return info.exists === true && info.isDirectory === false ? info.size : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * The real uploader: a binary-content PUT of the local file to the slot URL
 * with the slot's headers. Each upload gets its own AbortController, keyed
 * by message id, so two chats uploading at once stay independent and
 * cancelling one never touches the other.
 */
export function createAttachmentUploader(): AttachmentUploader {
  const controllers = new Map<string, AbortController>();
  return {
    async upload(
      file: PickedFile,
      slot: { putUrl: string; headers: Record<string, string> },
      onProgress?: (fraction: number) => void,
      messageId?: string,
    ): Promise<void> {
      const current = new AbortController();
      const key = messageId ?? file.uri;
      controllers.set(key, current);
      try {
        const source = new File(file.uri);
        const result = await source.upload(slot.putUrl, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers: { 'content-type': file.mimeType, ...slot.headers },
          mimeType: file.mimeType,
          onProgress:
            onProgress === undefined
              ? undefined
              : (data) => {
                  if (data.totalBytes > 0) {
                    onProgress(Math.min(1, Math.max(0, data.bytesSent / data.totalBytes)));
                  }
                },
          signal: current.signal,
        });
        if (result.status < 200 || result.status >= 300) {
          throw new Error(`upload refused: ${result.status}`);
        }
      } catch (error) {
        if (current.signal.aborted) {
          throw new Error('cancelled');
        }
        throw error;
      } finally {
        if (controllers.get(key) === current) {
          controllers.delete(key);
        }
      }
    },
    cancel(messageId: string): void {
      controllers.get(messageId)?.abort();
      controllers.delete(messageId);
    },
  };
}

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
    async open(
      url: string,
      name: string,
    ): Promise<{ status: 'opened' } | { status: 'error'; message: string }> {
      try {
        const headers = await authHeadersFor(url, options?.apiUrl, options?.getToken);
        const destination = new File(Paths.cache, cleanFilename(name));
        const controller = new AbortController();
        const file = await download(url, destination, {
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
        });
        await Share.share({ url: file.uri, title: cleanFilename(name) });
        return { status: 'opened' };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return { status: 'error', message: TOO_LARGE_MESSAGE };
        }
        return { status: 'error', message: OPEN_FAILED_MESSAGE };
      }
    },
  };
}

/** The sanitized cache destination for an attachment name (test seam). */
export function cacheDestinationFor(name: string): string {
  return cleanFilename(name);
}

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
    async download(gif) {
      if (!isLoadableGifPreviewUrl(gif.url, apiUrl)) {
        return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
      }
      const headers = await authHeadersFor(gif.url, apiUrl, getToken);
      const cacheDir = options?.cacheDir ?? FileSystem.cacheDirectory;
      if (cacheDir === null || cacheDir === undefined) {
        return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
      }
      const provisional = cleanFilename(`${gifFileName(gif.id, 'bin')}-${Date.now()}`);
      let result: FileSystem.FileSystemDownloadResult;
      try {
        result = await download(
          gif.url,
          `${cacheDir}${provisional}`,
          headers === undefined ? undefined : { headers },
        );
      } catch {
        return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
      }
      const contentType = isRecord(result) ? headerMimeType(result.headers ?? {}) : '';
      if (!isGifMediaType(contentType)) {
        return { status: 'error', message: GIF_DOWNLOAD_FAILED_MESSAGE };
      }
      const { mime, extension } = gifBlobType(contentType, gif.kind);
      const size = typeof result.uri === 'string' ? await fileSize(result.uri, getInfo) : 0;
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
    },
  };
}

async function fileSize(uri: string, getInfo: typeof FileSystem.getInfoAsync): Promise<number> {
  try {
    const info = await getInfo(uri);
    return info.exists === true && info.isDirectory === false ? info.size : 0;
  } catch {
    return 0;
  }
}

/**
 * The bearer token for our own API origin only. Any other host gets no auth
 * headers, so a hostile URL can never receive the session token.
 */
async function authHeadersFor(
  url: string,
  apiUrl: string | undefined,
  getToken: (() => Promise<string | undefined>) | undefined,
): Promise<Record<string, string> | undefined> {
  if (apiUrl === undefined || getToken === undefined) {
    return undefined;
  }
  let apiOrigin: string;
  let targetOrigin: string;
  try {
    apiOrigin = new URL(apiUrl).origin;
    targetOrigin = new URL(url).origin;
  } catch {
    return undefined;
  }
  if (apiOrigin !== targetOrigin) {
    return undefined;
  }
  const token = await getToken().catch(() => undefined);
  return token === undefined ? undefined : { authorization: `Bearer ${token}` };
}
