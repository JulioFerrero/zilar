const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter()
    : undefined;

/**
 * Splits a string into user-perceived characters (graphemes), so emoji
 * sequences, flags and ZWJ families count as one character. Falls back to
 * code-point iteration when `Intl.Segmenter` is unavailable.
 */
export function graphemes(value: string): string[] {
  if (segmenter === undefined) {
    return Array.from(value);
  }
  return Array.from(segmenter.segment(value), (segment) => segment.segment);
}
