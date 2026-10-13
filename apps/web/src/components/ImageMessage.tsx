import { type MouseEvent } from 'react';
import { mediaSrc, safeHttpUrl } from '@/lib/attachments';
import { useMediaRetry } from '@/lib/media-retry';
import { useMediaViewer } from './media/MediaViewer';

export interface ImageMessageProps {
  /** The chat JID, required by `GET /api/files`, which checks membership. */
  chatId: string;
  /** The message the image belongs to: the viewer starts here and steps around it. */
  messageId: string;
  url: string;
  alt: string;
  /** Pixel width, when known: reserves the aspect ratio before the image loads. */
  width?: number | undefined;
  /** Pixel height, when known: reserves the aspect ratio before the image loads. */
  height?: number | undefined;
}

/**
 * An image bubble. The space is reserved from the known size so the list never
 * jumps, the image is lazy, and only http(s) URLs are made clickable. A broken
 * image becomes a small tile instead of the browser's broken icon. A plain
 * click opens the chat's photo viewer (T-1232); on a link, a modified or middle
 * click still follows the href in a new tab.
 *
 * A just-sent upload (T-1337) keeps its local `blob:` preview on screen while
 * its `/api/files` copy 404s behind the indexer, retries that copy with
 * backoff, and only shows "Image unavailable" — with a Retry — when there was
 * no preview to fall back on and every attempt is spent.
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
  // The raw URL decides whether the image is linkable (the trust check never
  // changes); a same-origin upload then opens through the file route.
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
    // A modified or non-primary click keeps the browser's own behaviour: a new
    // tab on a link, and nothing on a plain image.
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
  // A `data:` or `blob:` image (the mock, an unsent upload) has no URL the
  // browser may follow, so the whole tile opens the viewer.
  if (openViewer === null) {
    return image;
  }
  return (
    <button type="button" aria-label={`View ${alt}`} onClick={open} className="block w-full">
      {image}
    </button>
  );
}
