// T-2042: one bounds-checked byte reader for the image headers the server
// parses. These readers see untrusted uploads (stickers and card media), so a
// read that starts before the buffer or runs past its end answers `null`
// instead of returning a number built from missing bytes.

export function readU16BE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length) {
    return null;
  }
  return bytes[offset]! * 0x100 + bytes[offset + 1]!;
}

export function readU16LE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length) {
    return null;
  }
  return bytes[offset]! + bytes[offset + 1]! * 0x100;
}

export function readU24LE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 3 > bytes.length) {
    return null;
  }
  return bytes[offset]! + bytes[offset + 1]! * 0x100 + bytes[offset + 2]! * 0x10000;
}

export function readU32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) {
    return null;
  }
  return (
    (bytes[offset]! * 0x1000000 +
      bytes[offset + 1]! * 0x10000 +
      bytes[offset + 2]! * 0x100 +
      bytes[offset + 3]!) >>>
    0
  );
}

export function readU32LE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) {
    return null;
  }
  return (
    (bytes[offset]! +
      bytes[offset + 1]! * 0x100 +
      bytes[offset + 2]! * 0x10000 +
      bytes[offset + 3]! * 0x1000000) >>>
    0
  );
}

export function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
