import { type MouseEvent } from 'react';
import { mediaSrc, safeHttpUrl } from '@/lib/attachments';
import { useMediaRetry } from '@/lib/media-retry';
import { useMediaViewer } from './media/MediaViewer';

export interface ImageMessageProps {
  /** The chat JID; `GET /api/files` checks membership. */
  chatId: string;
  messageId: string;
  url: string;
  alt: string;
  width?: number | undefined;
  height?: number | undefined;
}

/**
 * Reserves space from the known size so the list never jumps; only http(s)
 * URLs are clickable. A just-sent `blob:` preview stays while its `/api/files`
 * copy 404s behind the indexer.
 */
export function ImageMessage({ chatId, messageId, url, alt, width, height }: ImageMessageProps) {
  const openViewer = useMediaViewer();
  const media = useMediaRetry(chatId, url);

  if (media.unavailable) {
    return (
      <div className="flex h-[120px] w-full flex-col items-center justify-center gap-1.5 bg-well text-[13px] text-muted-foreground">
        <span>Image unavailable</span>
        <button type="button" onClick={media.retry} className="text-[12px] font-semibold underline">
          Retry
        </button>
      </div>
    );
  }

  const ratio = width !== undefined && height !== undefined ? `${width} / ${height}` : undefined;
  // The raw URL decides linkability; trusted same-origin uploads open through the file route.
  const href = safeHttpUrl(url) === undefined ? undefined : mediaSrc(chatId, url);
  const image = (
    <div className="relative">
      <img
        src={media.src}
        alt={alt}
        loading="lazy"
        {...(width === undefined ? {} : { width })}
        {...(height === undefined ? {} : { height })}
        onLoad={media.onLoad}
        onError={media.onError}
        style={ratio === undefined ? undefined : { aspectRatio: ratio }}
        className="max-h-[320px] w-full object-cover"
      />
      {media.preview !== undefined && !media.loaded && (
        <img
          src={media.preview}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );

  const open = (event: MouseEvent<HTMLElement>): void => {
    if (openViewer === null) {
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    openViewer({ chatId, messageId });
  };

  if (href !== undefined) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${alt}`}
        onClick={open}
        className="block"
      >
        {image}
      </a>
    );
  }
  if (openViewer === null) {
    return image;
  }
  return (
    <button type="button" aria-label={`View ${alt}`} onClick={open} className="block w-full">
      {image}
    </button>
  );
}
