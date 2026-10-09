import { Data, Effect } from 'effect';

/** The Clipboard API refused the text; the legacy path runs next. */
class ClipboardRejected extends Data.TaggedError('ClipboardRejected') {}

/**
 * Copies text to the clipboard. Uses the Clipboard API when available and
 * falls back to a temporary textarea with `document.execCommand`. A defect in
 * the legacy path rejects with the original error, as before.
 */
export function copyText(text: string): Promise<void> {
  return Effect.runPromise(copyEffect(text));
}

function copyEffect(text: string): Effect.Effect<void> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  const legacy = legacyCopy(text);
  if (clipboard === undefined) {
    return legacy;
  }
  return Effect.tryPromise({
    try: () => clipboard.writeText(text),
    catch: () => new ClipboardRejected(),
  }).pipe(Effect.catchTag('ClipboardRejected', () => legacy));
}

function legacyCopy(text: string): Effect.Effect<void> {
  if (typeof document === 'undefined') {
    return Effect.void;
  }
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      return textarea;
    }),
    () =>
      Effect.sync(() => {
        if (typeof document.execCommand === 'function') {
          document.execCommand('copy');
        }
      }),
    (textarea) =>
      Effect.sync(() => {
        document.body.removeChild(textarea);
      }),
  );
}
