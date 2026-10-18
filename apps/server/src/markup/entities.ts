// T-2040: one HTML entity decoder for the head metadata reader and the
// body-to-text extractor, which used to carry identical copies.
// effect-plain: pure entity decoding; malformed input is returned unchanged, no I/O
const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decodes the common named entities and numeric character references. */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (full, body: string) => {
    const named = ENTITY_MAP[body];
    if (named !== undefined) {
      return named;
    }
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
    }
    return full;
  });
}
