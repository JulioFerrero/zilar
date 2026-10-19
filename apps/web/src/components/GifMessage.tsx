import { useState } from 'react';
import { isGifVideoAttachment as isSharedGifVideoAttachment } from '@zilar/chat-core';
import type { Attachment } from '@zilar/chat-core';
import { mediaSrc, safeHttpUrl } from '@/lib/attachments';
import { useMediaQuery } from '@/lib/useMediaQuery';

export interface GifMessageProps {
  /** The chat JID; `GET /api/files` checks membership. */
  chatId: string;
  attachment: Attachment;
}

export function GifMessage({ chatId, attachment }: GifMessageProps) {
  const [broken, setBroken] = useState(false);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  if (broken) {
    return (
      <div className="flex h-[120px] w-full items-center justify-center bg-well text-[13px] text-muted-foreground">
        Video unavailable
      </div>
    );
  }

  const ratio =
    attachment.width !== undefined && attachment.height !== undefined
      ? `${attachment.width} / ${attachment.height}`
      : undefined;
  // The raw URL decides linkability; trusted same-origin uploads open through the file route.
  const src = mediaSrc(chatId, attachment.url);
  const href = safeHttpUrl(attachment.url) === undefined ? undefined : src;
  const video = (
    <video
      src={src}
      muted
      loop
      playsInline
      autoPlay={!reduceMotion}
      preload="metadata"
      aria-label={attachment.name}
      onError={() => setBroken(true)}
      style={ratio === undefined ? undefined : { aspectRatio: ratio }}
      className="max-h-[320px] w-full object-cover"
    />
  );
  if (href === undefined) {
    return video;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${attachment.name}`}
      className="block"
    >
      {video}
    </a>
  );
}

/**
 * A GIF send is trusted only on a relative same-origin `/api/` path or a known
 * media host; this is the second layer after the store sanitizer.
 */
export function isGifVideoAttachment(
  attachment: Attachment,
  trustedHosts: ReadonlySet<string>,
): boolean {
  return isSharedGifVideoAttachment(attachment, trustedHosts, true);
}
