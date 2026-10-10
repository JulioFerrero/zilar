import { Effect } from 'effect';
import { useEffect, useState } from 'react';

/**
 * One prepared sticker's preview. The object URL is owned by this node:
 * created on mount (or when the blob changes) and revoked when the node
 * leaves or the blob is replaced — so a URL is never revoked while its
 * `<img>` still shows it, and a StrictMode remount recreates instead of
 * reusing a revoked URL. A browser without `createObjectURL` gets the
 * placeholder the editor always had.
 */
export function BlobPreview({ blob, alt }: { blob: Blob; alt: string }) {
  // Created once per mount (never in an effect, so no set-state-in-effect):
  // the blob per item never changes, and a StrictMode remount recreates
  // instead of reusing a revoked URL.
  // A browser (or a test DOM) that refuses the blob gets the placeholder: the
  // refusal is caught by the Effect, not by a try block here.
  const [url] = useState(() =>
    Effect.runSync(
      Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => '')),
    ),
  );
  useEffect(
    () => () => {
      if (url !== '') {
        URL.revokeObjectURL(url);
      }
    },
    [url],
  );
  if (url === '') {
    return <span className="text-[13px] text-muted-foreground">…</span>;
  }
  return <img src={url} alt={alt} className="max-h-16 max-w-16 object-contain" />;
}
