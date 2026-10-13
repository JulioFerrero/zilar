import { describe, expect, it, vi } from 'vitest';

// The native modules the picker imports at load time; the test injects its own
// size reader and downscaler, so none of their methods are called.
const mediaLibrary = vi.hoisted(() => ({
  getAssetInfoAsync: vi.fn(async () => undefined),
  getAssetsAsync: vi.fn(async () => ({ assets: [], endCursor: '', hasNextPage: false })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

vi.mock('expo-media-library/legacy', () => mediaLibrary);
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-file-system/legacy', () => ({}));
vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

import type { ImageDownscaler } from '@/lib/attachment-downscale';
import { EMPTY_MESSAGE, TOO_LARGE_MESSAGE } from '@/lib/attachment-common';
import type { PickedFile } from '@/lib/attachment-ports';
import { createGalleryReader } from '@/lib/attachment-picker';

// T-1320: the Gallery grid stages through the same rules as the library pick,
// so a zero-byte or over-cap asset is refused with the same fixed sentence.

const ASSET = {
  id: 'asset-1',
  uri: 'ph://asset-1',
  filename: 'IMG_0001.jpg',
  mediaType: 'photo' as const,
  width: 100,
  height: 200,
  duration: 0,
};

const refuseDownscale: ImageDownscaler = {
  downscale: async () => {
    throw new Error('an empty or over-cap file must never be downscaled');
  },
};

function readerFor(size: number | undefined, downscaler: ImageDownscaler = refuseDownscale) {
  return createGalleryReader({ sizeReader: { sizeOf: async () => size }, downscaler });
}

describe('createGalleryReader.toPickedFile', () => {
  it('refuses a zero-byte asset with the library pick sentence', async () => {
    const result = await readerFor(0).toPickedFile(ASSET);
    expect(result).toEqual({ status: 'error', message: EMPTY_MESSAGE });
  });

  it('refuses an asset over the 50 MB cap with the library pick sentence', async () => {
    const result = await readerFor(50 * 1024 * 1024 + 1).toPickedFile(ASSET);
    expect(result).toEqual({ status: 'error', message: TOO_LARGE_MESSAGE });
  });

  it('stages a normal asset with its size and the downscaled file', async () => {
    const downscaler: ImageDownscaler = {
      downscale: async (file: PickedFile) => ({ ...file, uri: 'file://downscaled.jpg' }),
    };
    const result = await readerFor(1234, downscaler).toPickedFile(ASSET);
    expect(result).toEqual({
      status: 'picked',
      file: {
        uri: 'file://downscaled.jpg',
        name: 'IMG_0001.jpg',
        mimeType: 'image/jpeg',
        size: 1234,
        width: 100,
        height: 200,
      },
    });
  });
});

describe('createGalleryReader.requestPermission', () => {
  it('asks only for photo and video read access, never audio', async () => {
    mediaLibrary.requestPermissionsAsync.mockClear();
    await readerFor(undefined).requestPermission();
    expect(mediaLibrary.requestPermissionsAsync).toHaveBeenCalledWith(false, ['photo', 'video']);
  });
});
