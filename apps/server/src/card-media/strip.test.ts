// T-2005: the JPEG walker must keep the image data of baseline and
// progressive files, but stop at the first EOI so metadata appended after it
// (often GPS) never survives the strip.

import { describe, expect, it } from 'vitest';
import { stripImageMetadata } from './strip';

function segment(marker: number, payload: readonly number[]): Uint8Array {
  const length = payload.length + 2;
  return Uint8Array.from([0xff, marker, length >> 8, length & 0xff, ...payload]);
}

function bytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

const SOI = Uint8Array.from([0xff, 0xd8]);
const EOI = Uint8Array.from([0xff, 0xd9]);
const APP0 = segment(
  0xe0,
  [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00],
);
const APP1 = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04]);
const COM = segment(0xfe, [0x67, 0x70, 0x73]);
const SOF2 = segment(0xc2, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]);
const DHT = segment(0xc4, [0x00, 0x01, 0x02]);
const SOS = segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
const SCAN_ONE = Uint8Array.from([0x12, 0x34, 0xff, 0x00, 0x56]);
const SCAN_TWO = Uint8Array.from([0x78, 0x9a, 0xff, 0xd0, 0xbc, 0xde]);

describe('stripImageMetadata (JPEG)', () => {
  it('drops an Exif block appended after EOI', () => {
    const input = bytes(SOI, APP0, SOF2, SOS, SCAN_ONE, EOI, APP1, COM);
    const expected = bytes(SOI, APP0, SOF2, SOS, SCAN_ONE, EOI);

    expect(stripImageMetadata(input, 'image/jpeg')).toEqual(expected);
  });

  it('keeps both scans of a progressive JPEG and drops metadata between them', () => {
    const input = bytes(SOI, APP0, SOF2, DHT, SOS, SCAN_ONE, APP1, COM, SOS, SCAN_TWO, EOI, APP1);
    // The output is still a progressive JPEG: SOF2 and both SOS segments
    // remain, only the APP1/COM segments and the trailing block are gone.
    const expected = bytes(SOI, APP0, SOF2, DHT, SOS, SCAN_ONE, SOS, SCAN_TWO, EOI);

    expect(stripImageMetadata(input, 'image/jpeg')).toEqual(expected);
  });

  it('returns null when a scan has no EOI', () => {
    expect(stripImageMetadata(bytes(SOI, APP0, SOF2, SOS, SCAN_ONE), 'image/jpeg')).toBeNull();
  });
});
