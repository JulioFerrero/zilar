import { Effect, Option, Result, Schema, type Effect as EffectType } from 'effect';
import * as ImagePicker from 'expo-image-picker';
import { ProfileApiError, parseApiErrorBody } from '@/lib/profile-api';
import { runMobile } from '@/lib/effect/runtime';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File, UploadType } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';

/**
 * The seams the settings avatar control needs, in one place so tests inject
 * fakes and Vitest never loads the native modules.
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

/**
 * Re-encodes a picked picture into the upload bytes: a centred-square crop and
 * a 256 x 256 PNG. The server accepts PNG or WebP by magic bytes and phone photos
 * are JPEG, so every pick goes through this before the upload.
 */
export interface AvatarTranscoder {
  transcode(uri: string, width: number, height: number): Promise<{ uri: string }>;
}

export interface AvatarSizeReader {
  sizeOf(uri: string): Promise<number | undefined>;
}

export interface AvatarFileUploader {
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
const PREPARE_FAILED_MESSAGE = 'Could not prepare that picture. Try another photo.';
const EMPTY_MESSAGE = 'That picture file is empty.';
const TOO_LARGE_MESSAGE = 'The picture is larger than 256 KiB. Try a smaller file.';
const UPLOAD_FAILED_MESSAGE = 'Could not save the picture. Try again.';

/** Pictures over the server cap refuse before the upload starts. */
export const AVATAR_UPLOAD_MAX_BYTES = 256 * 1024;

/** The exported avatar size: the server wants 64–512 px square; 256 is web's export. */
export const AVATAR_EXPORT_SIDE = 256;

export function centeredSquareCrop(
  width: number,
  height: number,
): { originX: number; originY: number; width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const side = Math.min(width, height);
  return {
    originX: Math.floor((width - side) / 2),
    originY: Math.floor((height - side) / 2),
    width: Math.floor(side),
    height: Math.floor(side),
  };
}

export function createAvatarTranscoder(
  manipulate: typeof manipulateAsync = manipulateAsync,
): AvatarTranscoder {
  return {
    transcode(uri, width, height) {
      const crop = centeredSquareCrop(width, height);
      return runMobile(
        Effect.tryPromise({
          try: () =>
            manipulate(
              uri,
              [
                ...(crop === null ? [] : [{ crop }]),
                { resize: { width: AVATAR_EXPORT_SIDE, height: AVATAR_EXPORT_SIDE } },
              ],
              { format: SaveFormat.PNG },
            ),
          catch: (cause: unknown) => cause,
        }).pipe(Effect.map((result) => ({ uri: result.uri }))),
      );
    },
  };
}

export function createAvatarSizeReader(
  getInfo: typeof LegacyFileSystem.getInfoAsync = LegacyFileSystem.getInfoAsync,
): AvatarSizeReader {
  return {
    sizeOf(uri) {
      return runMobile(
        Effect.tryPromise({ try: () => getInfo(uri), catch: (cause: unknown) => cause }).pipe(
          Effect.match({
            onSuccess: (info) =>
              info.exists === true && info.isDirectory === false ? info.size : undefined,
            onFailure: () => undefined,
          }),
        ),
      );
    },
  };
}

/**
 * The picker flow as one Effect. Each early return is a result, not an error; a
 * failed permission call or size read still rejects, and the picker and
 * transcode failures become the fixed messages.
 */
const pickPictureEffect = Effect.fnUntraced(function* (
  reader: AvatarSizeReader,
  transcoder: AvatarTranscoder,
): EffectType.fn.Return<PickPictureResult> {
  const permission = yield* Effect.promise(() => ImagePicker.requestMediaLibraryPermissionsAsync());
  if (!permission.granted) {
    return { status: 'error', message: DENIED_MESSAGE };
  }
  // The system editor crops (`allowsEditing` + square aspect), because the phone
  // has no canvas crop dialog like web; the transcode then crops again from the
  // asset dimensions, so a sheet without an editor still yields a square PNG.
  const launched = yield* Effect.result(
    Effect.tryPromise({
      try: () =>
        ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.9,
        }),
      catch: (cause: unknown) => cause,
    }),
  );
  if (Result.isFailure(launched)) {
    return { status: 'error', message: PICK_FAILED_MESSAGE };
  }
  const result = launched.success;
  if (result.canceled) {
    return { status: 'cancelled' };
  }
  const asset = result.assets[0];
  if (asset === undefined) {
    return { status: 'cancelled' };
  }
  // Re-encode to the upload bytes (256 x 256 PNG): the server rejects JPEG by
  // magic bytes, and phone photos are JPEG.
  const transcoded = yield* Effect.result(
    Effect.tryPromise({
      try: () => transcoder.transcode(asset.uri, asset.width, asset.height),
      catch: (cause: unknown) => cause,
    }),
  );
  if (Result.isFailure(transcoded)) {
    return { status: 'error', message: PREPARE_FAILED_MESSAGE };
  }
  const { uri } = transcoded.success;
  // The caps apply to the real upload bytes, not the picked JPEG: an unknown size
  // is not an empty file, but a real zero refuses.
  const size = yield* Effect.promise(() => reader.sizeOf(uri));
  if (size !== undefined && size === 0) {
    return { status: 'error', message: EMPTY_MESSAGE };
  }
  if (size !== undefined && size > AVATAR_UPLOAD_MAX_BYTES) {
    return { status: 'error', message: TOO_LARGE_MESSAGE };
  }
  return {
    status: 'picked',
    picture: {
      uri,
      mimeType: 'image/png',
      width: AVATAR_EXPORT_SIDE,
      height: AVATAR_EXPORT_SIDE,
    },
  };
});

export function createPicturePicker(options?: {
  sizeReader?: AvatarSizeReader | undefined;
  transcoder?: AvatarTranscoder | undefined;
}): PicturePicker {
  const reader = options?.sizeReader ?? createAvatarSizeReader();
  const transcoder = options?.transcoder ?? createAvatarTranscoder();
  return {
    pickPicture() {
      return runMobile(pickPictureEffect(reader, transcoder));
    },
  };
}

const decodeJsonBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const jsonBody = (body: string): unknown => Option.getOrNull(decodeJsonBody(body));

export function parseAvatarUploadBody(body: string): { url: string } | null {
  const parsed = jsonBody(body);
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const url = (parsed as Record<string, unknown>)['url'];
  return typeof url === 'string' ? { url } : null;
}

export function createAvatarFileUploader(): AvatarFileUploader {
  return {
    upload(url, file, token, onProgress) {
      return runMobile(uploadEffect(url, file, token, onProgress));
    },
  };
}

const uploadEffect = Effect.fnUntraced(function* (
  url: string,
  file: PickedPicture,
  token: string,
  onProgress?: (fraction: number) => void,
): EffectType.fn.Return<{ url: string }, ProfileApiError> {
  const source = new File(file.uri);
  const result = yield* Effect.tryPromise({
    try: () =>
      source.upload(url, {
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
      }),
    catch: () => new ProfileApiError(0, 'network_error', 'Could not reach the server'),
  });
  if (result.status < 200 || result.status >= 300) {
    return yield* Effect.fail(toAvatarUploadError(result.status, result.body));
  }
  const parsed = parseAvatarUploadBody(result.body);
  if (parsed === null) {
    return yield* Effect.fail(new ProfileApiError(200, 'invalid_response', UPLOAD_FAILED_MESSAGE));
  }
  return parsed;
});

/**
 * Maps a refused avatar PUT to a `ProfileApiError`, so `friendlyAvatarError` can
 * show the specific reason (`avatar_too_large`, `rate_limited`, ...) instead of
 * the generic failure. A parseable `{ code, message }` envelope wins; otherwise
 * the status decides (413, 429, 400); anything else is generic.
 */
export function toAvatarUploadError(status: number, body: string): ProfileApiError {
  const { code, message } = parseApiErrorBody(jsonBody(body));
  if (code !== 'request_failed') {
    return new ProfileApiError(status, code, message ?? UPLOAD_FAILED_MESSAGE);
  }
  switch (status) {
    case 400:
      return new ProfileApiError(status, 'avatar_not_image', UPLOAD_FAILED_MESSAGE);
    case 413:
      return new ProfileApiError(status, 'avatar_too_large', UPLOAD_FAILED_MESSAGE);
    case 429:
      return new ProfileApiError(status, 'rate_limited', UPLOAD_FAILED_MESSAGE);
    default:
      return new ProfileApiError(status, 'request_failed', UPLOAD_FAILED_MESSAGE);
  }
}
