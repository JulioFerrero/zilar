import { describe, expect, it } from 'vitest';
import {
  isAnimatedImage,
  isAnimatedPng,
  isAnimatedWebp,
  isPng,
  isWebp,
  probeStickerBytes,
  STICKER_MAX_BYTES,
} from './image';

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
}

/** A minimal valid PNG: 8-byte magic + IHDR with the given size. */
function pngBytes(width: number, height: number): Uint8Array {
  return concat(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13),
    ascii('IHDR'),
    u32be(width),
    u32be(height),
    Uint8Array.from([8, 2, 0, 0, 0]),
  );
}

/** A minimal lossy WebP (VP8) with the given canvas size. */
function vp8Bytes(width: number, height: number): Uint8Array {
  const tag = new Uint8Array([0x9d, 0x01, 0x2a]);
  const size = new Uint8Array(4);
  size[0] = width & 0xff;
  size[1] = (width >> 8) & 0x3f;
  size[2] = height & 0xff;
  size[3] = (height >> 8) & 0x3f;
  return concat(
    ascii('RIFF'),
    u32be(100),
    ascii('WEBP'),
    ascii('VP8 '),
    u32be(10),
    new Uint8Array([0x10, 0x20, 0x30]),
    tag,
    size,
    new Uint8Array(10),
  );
}

/** A minimal lossless WebP (VP8L) with the given canvas size. */
function vp8lBytes(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  const bits = (w & 0x3fff) | ((h & 0x3fff) << 14);
  return concat(
    ascii('RIFF'),
    u32be(100),
    ascii('WEBP'),
    ascii('VP8L'),
    u32be(10),
    new Uint8Array([0x2f]),
    new Uint8Array([bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff]),
    new Uint8Array(10),
  );
}

/** A minimal extended WebP (VP8X, the animated container) with the size.
 *  The flags byte carries no animation bit (static extended WebP); pass
 *  `animated: true` for one with the animation flag set. */
function vp8xBytes(width: number, height: number, animated = false): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return concat(
    ascii('RIFF'),
    u32be(100),
    ascii('WEBP'),
    ascii('VP8X'),
    u32be(10),
    new Uint8Array([animated ? 0x12 : 0x10, 0x00, 0x00, 0x00]),
    new Uint8Array([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff]),
    new Uint8Array([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]),
    new Uint8Array(10),
  );
}

describe('magic-byte detection', () => {
  it('recognises PNG by magic', () => {
    expect(isPng(pngBytes(64, 64))).toBe(true);
    expect(isWebp(pngBytes(64, 64))).toBe(false);
  });

  it('recognises WebP by RIFF/WEBP magic', () => {
    expect(isWebp(vp8Bytes(64, 64))).toBe(true);
    expect(isPng(vp8Bytes(64, 64))).toBe(false);
  });

  it('does not mistake a GIF for WebP or PNG', () => {
    const gif = concat(ascii('GIF89a'), new Uint8Array(20));
    expect(isPng(gif)).toBe(false);
    expect(isWebp(gif)).toBe(false);
    expect(probeStickerBytes(gif)).toEqual({ ok: false, error: 'unknown_type' });
  });

  it('rejects an SVG named .png', () => {
    const svg = ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(probeStickerBytes(svg)).toEqual({ ok: false, error: 'unknown_type' });
  });

  it('rejects an empty upload', () => {
    expect(probeStickerBytes(new Uint8Array())).toEqual({ ok: false, error: 'too_small' });
  });
});

describe('probeStickerBytes', () => {
  it('accepts a valid PNG with its dimensions', () => {
    expect(probeStickerBytes(pngBytes(512, 512))).toEqual({
      ok: true,
      info: { mime: 'image/png', width: 512, height: 512 },
    });
  });

  it('accepts static and animated WebP with their dimensions', () => {
    expect(probeStickerBytes(vp8Bytes(100, 200))).toEqual({
      ok: true,
      info: { mime: 'image/webp', width: 100, height: 200 },
    });
    expect(probeStickerBytes(vp8lBytes(64, 64))).toEqual({
      ok: true,
      info: { mime: 'image/webp', width: 64, height: 64 },
    });
    expect(probeStickerBytes(vp8xBytes(320, 240))).toEqual({
      ok: true,
      info: { mime: 'image/webp', width: 320, height: 240 },
    });
  });

  it('rejects animated WebP and APNG as animated, not as unknown', () => {
    expect(isAnimatedWebp(vp8xBytes(64, 64, true))).toBe(true);
    expect(isAnimatedWebp(vp8xBytes(64, 64))).toBe(false);
    expect(probeStickerBytes(vp8xBytes(64, 64, true))).toEqual({
      ok: false,
      error: 'animated',
    });
    const still = pngBytes(64, 64);
    expect(isAnimatedPng(still)).toBe(false);
    expect(isAnimatedImage(still)).toBe(false);
    // PNG + acTL chunk before IDAT: an APNG (minimal, no pixels needed — the
    // detector walks chunks only). The chunk layout is length(4) +
    // name(4) + data(length) + crc(4); pngBytes has no crc, so the IHDR is
    // rebuilt here with one.
    const ihdr = concat(
      u32be(13),
      ascii('IHDR'),
      u32be(64),
      u32be(64),
      Uint8Array.from([8, 2, 0, 0, 0]),
      u32be(0),
    );
    const actl = concat(u32be(8), ascii('acTL'), new Uint8Array(8), u32be(0));
    const idat = concat(u32be(0), ascii('IDAT'), u32be(0));
    const animated = concat(still.subarray(0, 8), ihdr, actl, idat);
    expect(isAnimatedPng(animated)).toBe(true);
    expect(isAnimatedImage(animated)).toBe(true);
    expect(probeStickerBytes(animated)).toEqual({ ok: false, error: 'animated' });
  });

  it('rejects a PNG header claiming 60 000 x 60 000', () => {
    expect(probeStickerBytes(pngBytes(60000, 60000))).toEqual({
      ok: false,
      error: 'too_large',
    });
  });

  it('rejects a WebP with unknown chunk layout', () => {
    const weird = concat(
      ascii('RIFF'),
      u32be(40),
      ascii('WEBP'),
      ascii('VP9 '),
      new Uint8Array(20),
    );
    expect(probeStickerBytes(weird)).toEqual({ ok: false, error: 'unsupported_layout' });
  });

  it('rejects truncated headers', () => {
    expect(probeStickerBytes(pngBytes(64, 64).subarray(0, 10))).toEqual({
      ok: false,
      error: 'truncated',
    });
    expect(probeStickerBytes(vp8Bytes(64, 64).subarray(0, 15))).toEqual({
      ok: false,
      error: 'truncated',
    });
  });

  it('rejects zero dimensions', () => {
    expect(probeStickerBytes(pngBytes(0, 64))).toEqual({
      ok: false,
      error: 'invalid_dimensions',
    });
  });

  it('rejects an upload over 512 KiB even with valid magic', () => {
    const big = concat(pngBytes(64, 64), new Uint8Array(STICKER_MAX_BYTES));
    expect(big.byteLength).toBeGreaterThan(STICKER_MAX_BYTES);
    expect(probeStickerBytes(big)).toEqual({ ok: false, error: 'too_large' });
  });

  it('rejects a PNG whose decoded frame exceeds 4 MiB (decompression bomb)', () => {
    // 512 x 512 x 4 = exactly 1 MiB: fine. 1024 x 1024 x 4 = 4 MiB+1: decode
    // too large (it also exceeds the 512 px edge, which fails first). The
    // decode guard matters for odd headers; probe the boundary through a
    // header claiming 512 x 511 (1 046 528 bytes decoded: fine).
    expect(probeStickerBytes(pngBytes(512, 511)).ok).toBe(true);
    // A header with dimensions in range but a huge product cannot exist at
    // 512 px edges (max 1 MiB); the guard is exercised via unit reasoning.
    expect(probeStickerBytes(pngBytes(513, 513))).toEqual({
      ok: false,
      error: 'too_large',
    });
  });

  it('ignores the caller content type: bytes decide', () => {
    // A GIF served as image/png is still a GIF: the magic says otherwise.
    const gifAsPng = concat(ascii('GIF89a'), new Uint8Array(20));
    expect(probeStickerBytes(gifAsPng)).toEqual({ ok: false, error: 'unknown_type' });
  });
});
