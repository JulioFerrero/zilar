/**
 * Returns the URL to open when it is a safe external link, or `undefined` for
 * everything else. Only `http://` and `https://` pass, so `javascript:`,
 * `data:`, `file:` and other schemes can never be opened.
 */
export function safeLinkTarget(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}
