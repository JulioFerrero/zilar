// The avatar byte check, split out of `apps/server/src/avatars/service.ts`
// (T-1553). The avatar size constants live here: `checkAvatarBytes` and
// `toAvatarHttpError` are their only readers, and `service.ts` re-exports them
// so the barrel's export list is unchanged.

import { HttpError } from '../errors';
import { probeStickerBytes, type StickerImageInfo } from '../stickers/image';

export const AVATAR_MAX_BYTES = 256 * 1024;
export const AVATAR_MIN_SIDE = 64;
export const AVATAR_MAX_SIDE = 512;

export type AvatarProbeError =
  | 'avatar_empty'
  | 'avatar_too_large'
  | 'avatar_not_image'
  | 'avatar_animated'
  | 'avatar_not_square'
  | 'avatar_bad_size';

export interface AvatarCheck {
  info?: StickerImageInfo | undefined;
  error?: AvatarProbeError | undefined;
}

// Validates raw upload bytes: at most 256 KB, a static WebP or PNG by
// magic bytes (never the client's content type or file name), square, with
// a side in [64, 512]. Static-only: an animated WebP or APNG fails as
// `avatar_animated`, not as "not an image". The huge-decoded-size case
// ("claims a huge decoded size") is enforced upstream by the shared sticker
// probe (`too_large`/`decode_too_large` map to `avatar_not_image` below);
// past the square and 64..512 checks no further bomb check can fire
// (512 x 512 x 4 is 1 MiB, under the shared 4 MiB limit).
export function checkAvatarBytes(bytes: Uint8Array): AvatarCheck {
  if (bytes.byteLength === 0) {
    return { error: 'avatar_empty' };
  }
  if (bytes.byteLength > AVATAR_MAX_BYTES) {
    return { error: 'avatar_too_large' };
  }
  const probed = probeStickerBytes(bytes);
  if (!probed.ok) {
    return { error: 'avatar_not_image' };
  }
  const { info } = probed;
  // The probe stays animation-neutral for stickers (T-0120 accepts animated
  // WebP/APNG); only avatars reject animated images, checked here.
  if (info.animated) {
    return { error: 'avatar_animated' };
  }
  if (info.width !== info.height) {
    return { error: 'avatar_not_square' };
  }
  // The order matters: the shared sticker probe caps at 512 px, so a side
  // past the avatar range surfaces here as `avatar_bad_size` — except a
  // side past 512, which the probe already refused as `too_large` (mapped
  // to `avatar_not_image` above). Keep the square check first (a 1024x512
  // file is "not square", not "bad size").
  if (info.width < AVATAR_MIN_SIDE || info.width > AVATAR_MAX_SIDE) {
    return { error: 'avatar_bad_size' };
  }
  return { info };
}

export function toAvatarHttpError(check: AvatarCheck): HttpError {
  switch (check.error) {
    case 'avatar_empty':
      return new HttpError(400, 'avatar_empty', 'The picture file is empty');
    case 'avatar_too_large':
      return new HttpError(413, 'avatar_too_large', 'The picture is larger than 256 KiB');
    case 'avatar_animated':
      return new HttpError(400, 'avatar_animated', 'The picture must be a still image');
    case 'avatar_not_square':
      return new HttpError(400, 'avatar_not_square', 'The picture must be square');
    case 'avatar_bad_size':
      return new HttpError(
        400,
        'avatar_bad_size',
        `The picture must be between ${AVATAR_MIN_SIDE} and ${AVATAR_MAX_SIDE} pixels on each side`,
      );
    default:
      return new HttpError(400, 'avatar_not_image', 'The file is not a supported picture');
  }
}
