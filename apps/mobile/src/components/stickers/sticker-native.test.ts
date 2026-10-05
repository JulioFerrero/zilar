import { describe, expect, it, vi } from 'vitest';

import { STICKER_PREP_MAX_BYTES, createStickerPreparer, fitStickerSize } from './sticker-native';

vi.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
}));

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(async () => {
    throw new Error('no native modules in tests');
  }),
  SaveFormat: { PNG: 'png', JPEG: 'jpeg', WEBP: 'webp' },
}));

vi.mock('expo-file-system/legacy', () => ({
  getInfoAsync: vi.fn(async () => ({ exists: false })),
}));

describe('fitStickerSize', () => {
  it('keeps small images as-is and fits large ones keeping the ratio', () => {
    expect(fitStickerSize(200, 300)).toEqual({ width: 200, height: 300 });
    expect(fitStickerSize(1024, 512)).toEqual({ width: 512, height: 256 });
    expect(fitStickerSize(512, 1024)).toEqual({ width: 256, height: 512 });
  });
});

function preparerFor(sizes: Array<number | undefined>, manipulate?: never) {
  const queue = [...sizes];
  const reader = {
    sizeOf: vi.fn(async () => queue.shift() as number | undefined),
  };
  const preparer = createStickerPreparer(manipulate, reader);
  return { preparer, reader };
}

describe('createStickerPreparer', () => {
  const image = { uri: 'file:///cache/photo.jpg', width: 1024, height: 768 };

  it('tries WebP qualities in order and takes the first fit', async () => {
    const manipulate = vi.fn(
      async (uri: string, _actions: unknown, options: { compress?: number }) => ({
        uri: `file:///cache/q-${String(options.compress)}.webp`,
      }),
    );
    const { preparer } = preparerFor(
      [STICKER_PREP_MAX_BYTES + 1, STICKER_PREP_MAX_BYTES + 1, 94 * 1024],
      manipulate as never,
    );

    const result = await preparer.prepare(image);

    expect(result).toMatchObject({
      status: 'prepared',
      image: { mimeType: 'image/webp', width: 512, height: 384 },
    });
    const qualities = manipulate.mock.calls.map(
      (call) => (call[2] as { compress?: number }).compress,
    );
    expect(qualities).toEqual([0.92, 0.8, 0.7]);
  });

  it('falls back to one PNG try when no WebP fits, and errors when it is too big', async () => {
    const manipulate = vi.fn(
      async (_uri: string, _actions: unknown, options: { format?: string }) =>
        options.format === 'png'
          ? { uri: 'file:///cache/final.png' }
          : { uri: 'file:///cache/big.webp' },
    );
    const { preparer } = preparerFor(
      [
        STICKER_PREP_MAX_BYTES + 1,
        STICKER_PREP_MAX_BYTES + 1,
        STICKER_PREP_MAX_BYTES + 1,
        STICKER_PREP_MAX_BYTES + 1,
        STICKER_PREP_MAX_BYTES + 1,
        STICKER_PREP_MAX_BYTES + 1,
      ],
      manipulate as never,
    );

    const result = await preparer.prepare(image);

    expect(result).toEqual({
      status: 'error',
      message: 'This image is too big. A sticker can be up to 512 KB and 512 px.',
    });
    const formats = manipulate.mock.calls.map((call) => (call[2] as { format?: string }).format);
    expect(formats).toEqual(['webp', 'webp', 'webp', 'webp', 'webp', 'png']);
  });

  it('goes straight to the PNG try when every WebP save throws', async () => {
    const manipulate = vi.fn(
      async (_uri: string, _actions: unknown, options: { format?: string }) => {
        if (options.format !== 'png') {
          throw new Error('no webp encoder');
        }
        return { uri: 'file:///cache/final.png' };
      },
    );
    const { preparer } = preparerFor([50 * 1024], manipulate as never);

    const result = await preparer.prepare(image);

    expect(result).toMatchObject({ status: 'prepared', image: { mimeType: 'image/png' } });
  });

  it('reports an empty prepared file', async () => {
    const manipulate = vi.fn(async () => ({ uri: 'file:///cache/empty.webp' }));
    const { preparer } = preparerFor([0], manipulate as never);

    await expect(preparer.prepare(image)).resolves.toEqual({
      status: 'error',
      message: 'This image is empty.',
    });
  });

  it('reports a prepare failure when the PNG try throws', async () => {
    const manipulate = vi.fn(async () => {
      throw new Error('manipulator broke');
    });
    const { preparer } = preparerFor([], manipulate as never);

    await expect(preparer.prepare(image)).resolves.toEqual({
      status: 'error',
      message: 'This image could not be prepared.',
    });
  });
});
