// Message bodies are text that can be large. Anything above 64 KiB of UTF-8 is
// truncated on a code point boundary so a hostile peer cannot exhaust memory.
export const MAX_BODY_BYTES = 64 * 1024;

function utf8Size(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    bytes += utf8Size(character.codePointAt(0) ?? 0);
  }
  return bytes;
}

export function capBody(body: string): string {
  if (utf8ByteLength(body) <= MAX_BODY_BYTES) {
    return body;
  }

  let bytes = 0;
  let end = 0;
  for (const character of body) {
    const size = utf8Size(character.codePointAt(0) ?? 0);
    if (bytes + size > MAX_BODY_BYTES) {
      break;
    }
    bytes += size;
    end += character.length;
  }
  return body.slice(0, end);
}
