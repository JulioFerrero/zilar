import { Effect } from 'effect';
import { runWeb } from '@/lib/effect/runtime';

/** How long a PDF's blob: URL stays alive after its tab opens. */
const OBJECT_URL_TTL_MS = 60_000;

/** Fetches with the session's cookies and opens the bytes as an application/pdf blob: URL,
 * so the browser's PDF viewer renders them (the server always serves attachments). Resolves
 * false when the fetch or the tab fails. Only for PDFs: forcing the type would mask an
 * active HTML or SVG file. */
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

/** Falls back to a download when the tab or the fetch fails; onSettled runs once either way. */
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

/** The server's content-disposition: attachment does the real work; the attribute only names the file. */
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
