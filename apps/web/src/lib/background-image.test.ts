import { describe, expect, it, vi } from 'vitest';
import {
  fitWithin,
  prepareBackgroundImage,
  type BackgroundSize,
  type LoadedBackground,
} from './background-image';

const MIB = 1024 * 1024;

function sizedBlob(size: number): Blob {
  return { size } as unknown as Blob;
}

const loaded = (width: number, height: number): LoadedBackground => ({
  image: {} as CanvasImageSource,
  width,
  height,
});

describe('fitWithin', () => {
  it('scales a large image down to the max side', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2048, height: 1536 });
  });

  it('leaves a small image unchanged', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('prepareBackgroundImage', () => {
  it('steps the quality down until the result fits 1 MiB', async () => {
    const encode = vi
      .fn<
        (image: CanvasImageSource, size: BackgroundSize, quality: number) => Promise<Blob | null>
      >()
      .mockResolvedValueOnce(sizedBlob(2 * MIB))
      .mockResolvedValueOnce(sizedBlob(2 * MIB))
      .mockResolvedValueOnce(sizedBlob(500 * 1024));

    const blob = await prepareBackgroundImage(
      new File([new Uint8Array([1])], 'wall.png', { type: 'image/png' }),
      { load: async () => loaded(4000, 3000), encode },
    );

    expect(blob.size).toBe(500 * 1024);
    expect(encode.mock.calls.map((call) => call[2])).toEqual([0.85, 0.7, 0.5]);
    expect(encode.mock.calls[0]?.[1]).toEqual({ width: 2048, height: 1536 });
  });

  it('throws too_large when every quality is still too big', async () => {
    const encode = vi.fn(async () => sizedBlob(2 * MIB));

    await expect(
      prepareBackgroundImage(new File([new Uint8Array([1])], 'wall.png', { type: 'image/png' }), {
        load: async () => loaded(4000, 3000),
        encode,
      }),
    ).rejects.toThrow('too_large');
    expect(encode).toHaveBeenCalledTimes(3);
  });

  it('throws too_small before encoding when a side is under 64 px', async () => {
    const encode = vi.fn(async () => sizedBlob(10));

    await expect(
      prepareBackgroundImage(new File([new Uint8Array([1])], 'wall.png', { type: 'image/png' }), {
        load: async () => loaded(50, 500),
        encode,
      }),
    ).rejects.toThrow('too_small');
    expect(encode).not.toHaveBeenCalled();
  });
});
