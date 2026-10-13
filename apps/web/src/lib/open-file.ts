import { Effect } from 'effect';
import { runWeb } from '@/lib/effect/runtime';

/** How long a PDF's `blob:` URL stays alive after its tab opens. */
const OBJECT_URL_TTL_MS = 60_000;

/**
 * Fetches `url` with the session's cookies and opens the bytes in a new tab as
 * an `application/pdf` `blob:` URL, so the browser's own PDF viewer renders
 * them. The server keeps serving every file as an attachment (SEC-1); only the
 * client-side blob turns it into a viewer.
 *
 * Resolves to false when the fetch did not answer 2xx or the browser refused
 * the tab (a popup blocker), so the caller can download the file instead. Only
 * call this for a PDF: forcing the `application/pdf` blob type would otherwise
 * mask the real type of an active file (HTML, SVG).
 */
const openPdfTab = Effect.fnUntraced(function* (url: string): Effect.fn.Return<boolean, unknown> {
  const response = yield* Effect.tryPromise({
    try: () => fetch(url, { credentials: 'same-origin' }),
    catch: (error: unknown) => error,
  });
  if (!response.ok) {
    return false;
  }
  const blob = yield* Effect.tryPromise({
    try: () => response.blob(),
    catch: (error: unknown) => error,
  });
  const objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  const tab = window.open(objectUrl, '_blank');
  if (tab === null) {
    URL.revokeObjectURL(objectUrl);
    return false;
  }
  tab.opener = null;
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), OBJECT_URL_TTL_MS);
  return true;
});

/**
 * Opens a PDF in a new tab, falling back to a download when the tab or the
 * fetch fails. `onSettled` runs once the attempt is over, so the bubble can
 * stop its spinner. Fire-and-forget: the caller has nothing to await.
 */
export function openPdfInNewTab(url: string, name: string, onSettled?: () => void): void {
  void runWeb(openPdfTab(url).pipe(Effect.orElseSucceed(() => false))).then(
    (didOpen) => {
      if (!didOpen) {
        downloadFile(url, name);
      }
      onSettled?.();
    },
    () => onSettled?.(),
  );
}

/**
 * Saves `url` under `name` by clicking a temporary `<a download>`, the same
 * path the old link used. The server's `content-disposition: attachment` does
 * the real work; the attribute only names the saved file.
 */
export function downloadFile(url: string, name: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
}
