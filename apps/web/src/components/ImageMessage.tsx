import { useState } from 'react';
import { mediaSrc, safeHttpUrl } from '@/lib/attachments';

export interface ImageMessageProps {
  /** The chat JID, required by `GET /api/files`, which checks membership. */
  chatId: string;
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
 * image becomes a small tile instead of the browser's broken icon.
 */
export function ImageMessage({ chatId, url, alt, width, height }: ImageMessageProps) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div className="flex h-[120px] w-full items-center justify-center rounded-[12px] border border-edge bg-well text-[13px] text-muted-foreground">
        Image unavailable
      </div>
    );
  }

  const ratio = width !== undefined && height !== undefined ? `${width} / ${height}` : undefined;
  const src = mediaSrc(chatId, url);
  const image = (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      {...(width === undefined ? {} : { width })}
      {...(height === undefined ? {} : { height })}
      onError={() => setBroken(true)}
      style={ratio === undefined ? undefined : { aspectRatio: ratio }}
      className="max-h-[320px] w-full rounded-[12px] border border-edge object-cover shadow-[0_4px_10px_-3px_rgba(0,0,0,0.85)]"
    />
  );

  // The raw URL decides whether the image is linkable (the trust check never
  // changes); a same-origin upload then opens through the file route.
  const href = safeHttpUrl(url) === undefined ? undefined : src;
  if (href === undefined) {
    return image;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${alt}`}
      className="block"
    >
      {image}
    </a>
  );
}
