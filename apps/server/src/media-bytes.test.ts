import { describe, expect, it } from 'vitest';
import { readU16BE, readU16LE, readU24LE, readU32BE, readU32LE, writeU32LE } from './media-bytes';

const BYTES = Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9a]);

describe('media byte readers', () => {
  it('reads 16-bit values in both endiannesses', () => {
    expect(readU16BE(BYTES, 0)).toBe(0x1234);
    expect(readU16LE(BYTES, 0)).toBe(0x3412);
    expect(readU16BE(BYTES, 3)).toBe(0x789a);
    expect(readU16LE(BYTES, 3)).toBe(0x9a78);
  });

  it('reads a 24-bit value little-endian', () => {
    expect(readU24LE(BYTES, 1)).toBe(0x785634);
  });

  it('reads 32-bit values in both endiannesses', () => {
    expect(readU32BE(BYTES, 0)).toBe(0x12345678);
    expect(readU32LE(BYTES, 0)).toBe(0x78563412);
    expect(readU32BE(BYTES, 1)).toBe(0x3456789a);
    expect(readU32LE(BYTES, 1)).toBe(0x9a785634);
  });

  it('returns null when a read passes the end', () => {
    expect(readU16BE(BYTES, 4)).toBeNull();
    expect(readU16LE(BYTES, 4)).toBeNull();
    expect(readU24LE(BYTES, 3)).toBeNull();
    expect(readU32BE(BYTES, 2)).toBeNull();
    expect(readU32LE(BYTES, 2)).toBeNull();
    expect(readU32BE(new Uint8Array(0), 0)).toBeNull();
  });

  it('returns null for a negative offset', () => {
    expect(readU16BE(BYTES, -1)).toBeNull();
    expect(readU16LE(BYTES, -1)).toBeNull();
    expect(readU24LE(BYTES, -1)).toBeNull();
    expect(readU32BE(BYTES, -1)).toBeNull();
    expect(readU32LE(BYTES, -1)).toBeNull();
  });

  it('writes a little-endian u32 that reads back', () => {
    const out = new Uint8Array(4);
    writeU32LE(out, 0, 0x12345678);
    expect([...out]).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(readU32LE(out, 0)).toBe(0x12345678);

    writeU32LE(out, 0, 0xdeadbeef);
    expect(readU32LE(out, 0)).toBe(0xdeadbeef);
  });
});
