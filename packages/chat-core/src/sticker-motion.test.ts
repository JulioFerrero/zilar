import { describe, expect, it } from 'vitest';
import { sniffMotionBytes } from './sticker-motion';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

/** ASCII char codes for the given text. */
function ascii(text: string): number[] {
  return text.split('').map((char) => char.charCodeAt(0));
}

const PNG_SIGNATURE = [...ascii('\u0089PNG\r\n\u001a\n')];

describe('sniffMotionBytes', () => {
  it('reads a GIF from its signature', () => {
    expect(sniffMotionBytes(Uint8Array.from(ascii('GIF89a')))).toBe('gif');
    expect(sniffMotionBytes(Uint8Array.from(ascii('GIF87a')))).toBe('gif');
  });

  it('reads WebM/Matroska from the EBML header', () => {
    expect(sniffMotionBytes(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00))).toBe('video');
  });

  it('reads an MP4/MOV `ftyp` box as video', () => {
    expect(sniffMotionBytes(Uint8Array.from([0, 0, 0, 0, ...ascii('ftypisom')]))).toBe('video');
  });

  it('keeps a still HEIF/AVIF `ftyp` brand off the video path', () => {
    expect(sniffMotionBytes(Uint8Array.from([0, 0, 0, 0, ...ascii('ftypavif')]))).toBeNull();
    expect(sniffMotionBytes(Uint8Array.from([0, 0, 0, 0, ...ascii('ftypheic')]))).toBeNull();
  });

  it('reads an animated WebP from the VP8X animation flag', () => {
    const animated = Uint8Array.from([
      ...ascii('RIFF'),
      0x04,
      0x00,
      0x00,
      0x00,
      ...ascii('WEBP'),
      ...ascii('VP8X'),
      0x0a,
      0x00,
      0x00,
      0x00,
      0x02,
      0x00,
      0x00,
      0x00,
    ]);
    expect(sniffMotionBytes(animated)).toBe('animated-webp');
  });

  it('keeps a still WebP off the motion path', () => {
    const still = Uint8Array.from([
      ...ascii('RIFF'),
      0x04,
      0x00,
      0x00,
      0x00,
      ...ascii('WEBP'),
      ...ascii('VP8 '),
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    expect(sniffMotionBytes(still)).toBeNull();
  });

  it('reads an APNG from an acTL chunk before the first IDAT', () => {
    const apng = Uint8Array.from([
      ...PNG_SIGNATURE,
      0x00,
      0x00,
      0x00,
      0x00,
      ...ascii('acTL'),
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    expect(sniffMotionBytes(apng)).toBe('apng');
  });

  it('keeps a still PNG off the motion path', () => {
    const png = Uint8Array.from([
      ...PNG_SIGNATURE,
      0x00,
      0x00,
      0x00,
      0x00,
      ...ascii('IDAT'),
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    expect(sniffMotionBytes(png)).toBeNull();
  });

  it('returns null for bytes that are not a known image or video', () => {
    expect(sniffMotionBytes(bytes(0x00, 0x01, 0x02, 0x03))).toBeNull();
    expect(sniffMotionBytes(new Uint8Array())).toBeNull();
  });
});
