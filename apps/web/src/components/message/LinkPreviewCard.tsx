// T-1234: a small card under a message's first https link. It unfurls one
// https URL through the API (which caps what it returns), shows nothing while
// loading or when the page has nothing, and links out in a new tab.
// effect-plain: presentational card; the api module owns the fetch and cache
import { useEffect, useState } from 'react';
import { linkPreview, type LinkPreview } from '@/lib/api/media';

type PreviewState =
  { kind: 'loading' } | { kind: 'none' } | { kind: 'ready'; preview: LinkPreview };

export function LinkPreviewCard({ url }: { url: string }) {
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  // T-1252: the image URL that failed to load, so a broken thumbnail hides.
  const [brokenImage, setBrokenImage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // The api module caches and dedupes, so a re-render never refetches.
    linkPreview(url).then((preview) => {
      if (!active) {
        return;
      }
      setState(preview === null ? { kind: 'none' } : { kind: 'ready', preview });
    });
    return () => {
      active = false;
    };
  }, [url]);

  if (state.kind !== 'ready') {
    return null;
  }

  const { title, description, siteName, image } = state.preview;
  const showImage = image !== undefined && image !== brokenImage;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`mx-3 mb-2 ${showImage ? 'flex items-start gap-3' : 'block'} overflow-hidden rounded-[10px] border border-border bg-well px-3 py-2 no-underline`}
    >
      {showImage && (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setBrokenImage(image ?? null)}
          className="h-16 w-16 shrink-0 rounded-md object-cover"
        />
      )}
      <span className={showImage ? 'block min-w-0 flex-1' : 'block'}>
        {siteName !== undefined && (
          <span className="block truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {siteName}
          </span>
        )}
        {title !== undefined && (
          <span className="mt-0.5 block text-[13px] leading-snug font-semibold text-foreground">
            {title}
          </span>
        )}
        {description !== undefined && (
          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </a>
  );
}
