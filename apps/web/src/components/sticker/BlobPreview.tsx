import { Effect } from 'effect';
import { useEffect, useRef, useState } from 'react';

/**
 * One prepared sticker's preview. The object URL is owned by this node: it is
 * created on mount and revoked when the node leaves, so it stays alive while
 * its `<img>`/`<video>` shows it. A browser (or a test DOM) that refuses
 * `createObjectURL` gets the placeholder the editor always had.
 *
 * StrictMode runs a throwaway setup/cleanup/setup cycle right after mount, so a
 * revoke done in that cleanup would kill the URL the element still shows — the
 * bug that left a picked GIF or video as a broken image (a still was already
 * decoded by then). The cleanup defers the revoke by a microtask and the next
 * setup cancels it; a real unmount has no setup after it, so the revoke stands.
 */
export function BlobPreview({
  blob,
  alt,
  video,
}: {
  blob: Blob;
  alt: string;
  /** A moving video previews through `<video>`; anything else through `<img>`. */
  video?: boolean | undefined;
}) {
  // Created once per mount: the blob per item never changes (items are keyed by
  // their key), and a StrictMode remount reuses the same URL instead of
  // recreating it.
  const [url] = useState(() =>
    Effect.runSync(
      Effect.try(() => URL.createObjectURL(blob)).pipe(Effect.orElseSucceed(() => '')),
    ),
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => {
        if (!mounted.current && url !== '') {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [url]);
  if (url === '') {
    return <span className="text-[13px] text-muted-foreground">…</span>;
  }
  if (video === true) {
    return (
      <video
        src={url}
        muted
        loop
        autoPlay
        playsInline
        className="max-h-16 max-w-16 object-contain"
        aria-label={alt}
      />
    );
  }
  return <img src={url} alt={alt} className="max-h-16 max-w-16 object-contain" />;
}
