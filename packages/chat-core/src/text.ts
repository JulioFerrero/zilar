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

const MAX_PLACEHOLDER_TITLE_LENGTH = 18;

/**
 * The composer placeholder for a chat. A long title wraps the placeholder on a
 * phone-width composer, and the header already shows the full title.
 */
export function composerPlaceholder(title: string | undefined): string {
  if (title === undefined || title === '' || title.length > MAX_PLACEHOLDER_TITLE_LENGTH) {
    return 'Message';
  }
  return `Message ${title}`;
}
