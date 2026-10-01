import { useState } from 'react';
import type { Attachment } from '@galena/chat-core';
import { safeHttpUrl } from '@/lib/attachments';
import { useMediaQuery } from '@/lib/useMediaQuery';

export interface GifMessageProps {
  attachment: Attachment;
}

/**
 * A GIF-origin video attachment (T-0122): sent through the GIF tab as kind
 * `file` with a video mime, shown inline as a looping muted video. Still
 * images (gif/webp) arrive as kind `image` and render in `ImageMessage`;
 * this covers mp4/webm only. `prefers-reduced-motion` shows a paused frame.
 */
export function GifMessage({ attachment }: GifMessageProps) {
  const [broken, setBroken] = useState(false);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  if (broken) {
    return (
      <div className="flex h-[120px] w-full items-center justify-center rounded-[12px] border border-edge bg-well text-[13px] text-muted-foreground">
        Video unavailable
      </div>
    );
  }

  const ratio =
    attachment.width !== undefined && attachment.height !== undefined
      ? `${attachment.width} / ${attachment.height}`
      : undefined;
  const href = safeHttpUrl(attachment.url);
  const video = (
    <video
      src={attachment.url}
      muted
      loop
      playsInline
      autoPlay={!reduceMotion}
      preload="metadata"
      aria-label={attachment.name}
      onError={() => setBroken(true)}
      style={ratio === undefined ? undefined : { aspectRatio: ratio }}
      className="max-h-[320px] w-full rounded-[12px] border border-edge object-cover shadow-[0_4px_10px_-3px_rgba(0,0,0,0.85)]"
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
 * Whether a file attachment is a GIF-origin video: the GIF send path names
 * files `gif-<id>.gif` with a video mime (mp4/webm are never images per
 * `classify`), so only those render inline. A peer naming their own upload
 * `gif-x` with a video mime renders the same way — the bytes still come from
 * the trusted upload host via the sanitizer, like any attachment.
 */
export function isGifVideoAttachment(attachment: Attachment): boolean {
  if (attachment.kind !== 'file') {
    return false;
  }
  if (attachment.mime !== 'video/mp4' && attachment.mime !== 'video/webm') {
    return false;
  }
  return attachment.name.startsWith('gif-');
}
