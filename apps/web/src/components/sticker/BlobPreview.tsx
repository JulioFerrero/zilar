import { Effect } from 'effect';
import { useEffect, useRef, useState } from 'react';

/**
 * The object URL is owned by this node: created on mount and revoked when it
 * leaves. StrictMode's throwaway setup/cleanup/setup would revoke the URL the
 * element still shows, so the cleanup defers the revoke by a microtask and the
 * next setup cancels it; a real unmount has no setup, so the revoke stands.
 */
export function BlobPreview({
  blob,
  alt,
  video,
}: {
  blob: Blob;
  alt: string;
  video?: boolean | undefined;
}) {
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
