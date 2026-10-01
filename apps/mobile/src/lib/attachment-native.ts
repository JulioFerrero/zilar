/**
 * The real native attachment seams (T-0150): `expo-image-picker` for photos,
 * videos and the camera, `expo-document-picker` for generic files,
 * `expo-file-system` for the XEP-0363 PUT, and `expo-sharing` for opening
 * downloaded files. Only imported by the chat screen (and tests through the
 * port interfaces), so Vitest never loads the native modules uninvoked.
 */

import * as DocumentPicker from 'expo-document-picker';
import { File, Paths, UploadType } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Share } from 'react-native';

import { extensionForMime, MAX_ATTACHMENT_BYTES, mimeForAsset } from './attachments';
import type {
  AttachmentOpener,
  AttachmentPicker,
  AttachmentUploader,
  PickedFile,
  PickResult,
} from './attachment-ports';

export type { PickedFile, PickResult } from './attachment-ports';

const TOO_LARGE_MESSAGE = 'That file is larger than 50 MB.';
const EMPTY_MESSAGE = 'That file is empty.';
const DENIED_MESSAGE =
  'Galena needs access to your photos to attach them. You can allow it in Settings.';
const CAMERA_DENIED_MESSAGE =
  'Galena needs access to your camera to take a photo. You can allow it in Settings.';
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
}): PickResult {
  if (input.size !== undefined && input.size === 0) {
    return { status: 'error', message: EMPTY_MESSAGE };
  }
  if (tooLarge(input.size)) {
    return { status: 'error', message: TOO_LARGE_MESSAGE };
  }
  const mime = mimeForAsset(input.mimeType);
  const fallbackName = `photo.${extensionForMime(mime)}`;
  const file: PickedFile = {
    uri: input.uri,
    name: input.name ?? fallbackName,
    mimeType: mime,
    size: input.size ?? 0,
  };
  if (input.width !== undefined && input.height !== undefined) {
    file.width = input.width;
    file.height = input.height;
  }
  return { status: 'picked', file };
}

/** The real picker: library (photo or video), camera, and generic files. */
export function createAttachmentPicker(): AttachmentPicker {
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
      return pickedFile({
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
      return pickedFile({
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
      return pickedFile({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      });
    },
  };
}

/**
 * The real uploader: a binary-content PUT of the local file to the slot URL
 * with the slot's headers. Cancellation aborts the in-flight task, so a
 * later `upload` starts fresh.
 */
export function createAttachmentUploader(): AttachmentUploader {
  let controller: AbortController | undefined;
  return {
    async upload(
      file: PickedFile,
      slot: { putUrl: string; headers: Record<string, string> },
      onProgress?: (fraction: number) => void,
    ): Promise<void> {
      controller?.abort();
      const current = new AbortController();
      controller = current;
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
        if (controller === current) {
          controller = undefined;
        }
      }
    },
    cancel(): void {
      controller?.abort();
      controller = undefined;
    },
  };
}

/**
 * The real opener: downloads the attachment to the cache directory (with the
 * session bearer when it is our own API origin) and opens the system
 * share/open sheet. Nothing is fetched without a tap: the screen only calls
 * this from a press handler.
 */
export function createAttachmentOpener(options?: {
  apiUrl?: string | undefined;
  getToken?: (() => Promise<string | undefined>) | undefined;
}): AttachmentOpener {
  return {
    async open(
      url: string,
      name: string,
    ): Promise<{ status: 'opened' } | { status: 'error'; message: string }> {
      try {
        const headers = await authHeadersFor(url, options?.apiUrl, options?.getToken);
        const destination = new File(Paths.cache, name);
        const file = await File.downloadFileAsync(url, destination, {
          idempotent: true,
          ...(headers === undefined ? {} : { headers }),
        });
        await Share.share({ url: file.uri, title: name });
        return { status: 'opened' };
      } catch {
        return { status: 'error', message: OPEN_FAILED_MESSAGE };
      }
    },
  };
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
