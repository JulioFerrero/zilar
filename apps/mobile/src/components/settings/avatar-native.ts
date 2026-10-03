import * as ImagePicker from 'expo-image-picker';
import { File, UploadType } from 'expo-file-system';

/**
 * The seams the settings avatar control needs, kept in one place so tests
 * inject fakes and never touch the native modules. Only imported by the
 * settings screens (and tests through these interfaces), so Vitest never
 * loads the native modules uninvoked.
 */

export interface PickedPicture {
  uri: string;
  mimeType: string;
  width: number;
  height: number;
}

export type PickPictureResult =
  | { status: 'picked'; picture: PickedPicture }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export interface PicturePicker {
  pickPicture(): Promise<PickPictureResult>;
}

export interface AvatarFileUploader {
  /**
   * PUTs the local file to the avatar slot and resolves the server's
   * `{ url }` body. `onProgress` reports 0–1 while the bytes go up.
   */
  upload(
    url: string,
    file: PickedPicture,
    token: string,
    onProgress?: (fraction: number) => void,
  ): Promise<{ url: string }>;
}

const DENIED_MESSAGE =
  'Zilar needs access to your photos to change your picture. You can allow it in Settings.';
const PICK_FAILED_MESSAGE = 'Could not pick that picture. Try again.';
const EMPTY_MESSAGE = 'That picture file is empty.';
const TOO_LARGE_MESSAGE = 'The picture is larger than 256 KiB. Try a smaller file.';
const UPLOAD_FAILED_MESSAGE = 'Could not save the picture. Try again.';

/** Pictures over the server cap refuse before the upload starts. */
export const AVATAR_UPLOAD_MAX_BYTES = 256 * 1024;

function mimeForAsset(mimeType: string | undefined): string {
  const lower = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (lower === 'image/png' || lower === 'image/webp' || lower === 'image/gif') {
    return lower;
  }
  return 'image/jpeg';
}

function pictureFromAsset(asset: {
  uri: string;
  mimeType?: string | undefined;
  width: number;
  height: number;
  fileSize?: number | undefined;
}): PickPictureResult {
  // Like the attachment picker: an unknown size is not an empty file, but a
  // real zero refuses, and anything over the server cap refuses up front.
  if (asset.fileSize !== undefined && asset.fileSize === 0) {
    return { status: 'error', message: EMPTY_MESSAGE };
  }
  if (asset.fileSize !== undefined && asset.fileSize > AVATAR_UPLOAD_MAX_BYTES) {
    return { status: 'error', message: TOO_LARGE_MESSAGE };
  }
  return {
    status: 'picked',
    picture: {
      uri: asset.uri,
      mimeType: mimeForAsset(asset.mimeType),
      width: asset.width,
      height: asset.height,
    },
  };
}

/** The real picture picker: the photo library, square-ish, editable. */
export function createPicturePicker(): PicturePicker {
  return {
    async pickPicture() {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        return { status: 'error', message: DENIED_MESSAGE };
      }
      let result: ImagePicker.ImagePickerResult;
      try {
        // The system editor crops (`allowsEditing` + square aspect): the
        // phone has no canvas crop dialog like web, so the OS sheet does it.
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.9,
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
      return pictureFromAsset(asset);
    },
  };
}

/** Parses the upload response body into the avatar url, or null when unexpected. */
export function parseAvatarUploadBody(body: string): { url: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const url = (parsed as Record<string, unknown>)['url'];
  return typeof url === 'string' ? { url } : null;
}

/** The real avatar file uploader: a binary-content PUT with the session bearer. */
export function createAvatarFileUploader(): AvatarFileUploader {
  return {
    async upload(url, file, token, onProgress) {
      const source = new File(file.uri);
      let result: { status: number; body: string };
      try {
        result = await source.upload(url, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers: { 'content-type': file.mimeType, authorization: `Bearer ${token}` },
          mimeType: file.mimeType,
          onProgress:
            onProgress === undefined
              ? undefined
              : (data) => {
                  if (data.totalBytes > 0) {
                    onProgress(Math.min(1, Math.max(0, data.bytesSent / data.totalBytes)));
                  }
                },
        });
      } catch {
        throw new Error(UPLOAD_FAILED_MESSAGE);
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(UPLOAD_FAILED_MESSAGE);
      }
      const parsed = parseAvatarUploadBody(result.body);
      if (parsed === null) {
        throw new Error(UPLOAD_FAILED_MESSAGE);
      }
      return parsed;
    },
  };
}

/** The cache copy of a picked picture, so the preview survives a library move. */
export function stagedAvatarName(mimeType: string): string {
  const lower = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (lower === 'image/png') return 'avatar-staged.png';
  if (lower === 'image/webp') return 'avatar-staged.webp';
  return 'avatar-staged.jpg';
}
