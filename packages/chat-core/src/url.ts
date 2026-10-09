// effect-plain: total parse helpers; a failed parse is a value, not an error
/// <reference lib="dom" />
/**
 * Parses an absolute URL. Returns `undefined` for a relative or malformed input
 * instead of throwing.
 */
export function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

/** Decodes a URI component. Returns the input unchanged when it is not valid percent-encoding. */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
