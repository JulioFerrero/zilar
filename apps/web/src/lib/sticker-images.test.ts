import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fitStickerSize,
  formatStickerSize,
  prepareStickerImage,
  PrepError,
  STICKER_PREP_MAX_BYTES,
  type PrepDeps,
} from './sticker-images';

function blobOf(size: number): Blob {
  return new Blob([new Uint8Array(size)]);
}

function fileOf(type: string, name = 'photo.png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function depsWith(overrides: Partial<PrepDeps>): PrepDeps {
  return {
    decode: async () => ({ width: 100, height: 100, image: {} }),
    encode: async () => blobOf(1024),
    ...overrides,
  };
}

describe('fitStickerSize', () => {
  it('keeps a wide photo inside 512 px keeping the ratio', () => {
    expect(fitStickerSize(800, 600)).toEqual({ width: 512, height: 384 });
  });

  it('keeps a tall photo inside 512 px keeping the ratio', () => {
    expect(fitStickerSize(600, 800)).toEqual({ width: 384, height: 512 });
  });

  it('leaves a small image as-is', () => {
    expect(fitStickerSize(100, 80)).toEqual({ width: 100, height: 80 });
  });

  it('leaves a 512 px image as-is', () => {
    expect(fitStickerSize(512, 512)).toEqual({ width: 512, height: 512 });
  });
});

describe('prepareStickerImage', () => {
  it('encodes WebP at 0.92 first and reports the fitted size', async () => {
    const seen: Array<{ mime: string; quality: number; width: number; height: number }> = [];
    const result = await prepareStickerImage(
      fileOf('image/jpeg', 'photo.jpg'),
      depsWith({
        decode: async () => ({ width: 800, height: 600, image: {} }),
        encode: async (_image, width, height, mime, quality) => {
          seen.push({ mime, quality, width, height });
          return blobOf(80 * 1024);
        },
      }),
    );
    expect(result.mime).toBe('image/webp');
    expect(result.width).toBe(512);
    expect(result.height).toBe(384);
    expect(result.bytes).toBe(80 * 1024);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ mime: 'image/webp', quality: 0.92, width: 512, height: 384 });
  });

  it('steps the quality down while over the cap', async () => {
    const qualities: number[] = [];
    const result = await prepareStickerImage(
      fileOf('image/png'),
      depsWith({
        encode: async (_image, _width, _height, _mime, quality) => {
          qualities.push(quality);
          return blobOf(quality > 0.7 ? STICKER_PREP_MAX_BYTES + 1 : 300 * 1024);
        },
      }),
    );
    expect(result.mime).toBe('image/webp');
    expect(result.bytes).toBe(300 * 1024);
    expect(qualities).toEqual([0.92, 0.8, 0.7]);
  });

  it('falls back to PNG when the browser cannot encode WebP', async () => {
    const mimes: string[] = [];
    const result = await prepareStickerImage(
      fileOf('image/png'),
      depsWith({
        encode: async (_image, _width, _height, mime) => {
          mimes.push(mime);
          return mime === 'image/webp' ? null : blobOf(200 * 1024);
        },
      }),
    );
    expect(result.mime).toBe('image/png');
    expect(mimes).toEqual(['image/webp', 'image/png']);
  });

  it('fails a file that stays over the cap at every quality', async () => {
    const error = await prepareStickerImage(
      fileOf('image/webp', 'huge.webp'),
      depsWith({
        encode: async (_image, _width, _height, mime) =>
          mime === 'image/webp'
            ? blobOf(STICKER_PREP_MAX_BYTES + 1)
            : blobOf(STICKER_PREP_MAX_BYTES + 1),
      }),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PrepError);
    expect((error as PrepError).reason).toBe('too_large');
    expect((error as PrepError).message).toContain('huge.webp');
  });

  it('rejects an unsupported type before decoding', async () => {
    let decoded = false;
    const error = await prepareStickerImage(
      fileOf('image/svg+xml', 'art.svg'),
      depsWith({
        decode: async () => {
          decoded = true;
          return { width: 10, height: 10, image: {} };
        },
      }),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PrepError);
    expect((error as PrepError).reason).toBe('unsupported_type');
    expect(decoded).toBe(false);
  });

  it('reports a decode failure per file', async () => {
    const error = await prepareStickerImage(
      fileOf('image/png', 'broken.png'),
      depsWith({
        decode: async () => {
          throw new Error('nope');
        },
      }),
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PrepError);
    expect((error as PrepError).reason).toBe('decode_failed');
  });
});

describe('formatStickerSize', () => {
  it('formats dimensions and KiB', () => {
    expect(formatStickerSize(320, 410, 84 * 1024)).toBe('320×410 · 84 KiB');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('default browser deps', () => {
  it('keeps the bitmap open until the final encode', async () => {
    // A closed ImageBitmap is detached: drawImage throws on it (WHATWG HTML
    // §4.12.5.1.9), so the default decode must not close before encoding.
    let closed = false;
    let draws = 0;
    const bitmap = {
      width: 800,
      height: 600,
      close: () => {
        closed = true;
      },
    };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const drawImage = (): void => {
      draws += 1;
      if (closed) {
        throw new Error('InvalidStateError: detached ImageBitmap');
      }
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: (blob: Blob | null) => void) => {
        callback(new Blob([new Uint8Array(100)]));
      },
    };
    vi.spyOn(document, 'createElement').mockReturnValue(fakeCanvas as unknown as HTMLElement);

    const result = await prepareStickerImage(fileOf('image/png'));
    expect(result.mime).toBe('image/webp');
    expect(result.width).toBe(512);
    expect(result.height).toBe(384);
    expect(draws).toBe(1);
    // Released after the final encode, never before the draw.
    expect(closed).toBe(true);
  });

  it('fails when the bitmap is closed before the draw', async () => {
    // Guards the regression directly: closing in decode breaks the encode.
    let closed = false;
    const bitmap = {
      width: 100,
      height: 100,
      close: () => {
        closed = true;
      },
    };
    const drawImage = (): void => {
      if (closed) {
        throw new Error('InvalidStateError: detached ImageBitmap');
      }
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: (blob: Blob | null) => void) => {
        callback(new Blob([new Uint8Array(100)]));
      },
    };
    vi.spyOn(document, 'createElement').mockReturnValue(fakeCanvas as unknown as HTMLElement);

    interface FakeCanvasContext {
      drawImage: (image: unknown, x: number, y: number, w: number, h: number) => void;
    }
    interface FakeCanvas {
      getContext: (kind: string) => FakeCanvasContext;
      toBlob: (callback: (blob: Blob | null) => void, mime: string) => void;
    }
    const error = await prepareStickerImage(fileOf('image/png'), {
      decode: async () => {
        const decoded = { width: bitmap.width, height: bitmap.height, image: bitmap };
        bitmap.close();
        return decoded;
      },
      encode: async (image, width, height, mime, quality) => {
        void width;
        void height;
        void quality;
        const canvas = document.createElement('canvas') as unknown as FakeCanvas;
        const context = canvas.getContext('2d');
        try {
          context.drawImage(image, 0, 0, 100, 100);
        } catch {
          return null;
        }
        return new Promise<Blob | null>((resolve) => {
          canvas.toBlob((blob) => resolve(blob), mime);
        });
      },
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PrepError);
    expect((error as PrepError).reason).toBe('encode_failed');
  });
});
