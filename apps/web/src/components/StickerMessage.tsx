import { useState } from 'react';
import type { Sticker } from '@galena/protocol';
import { isSameOriginStickerUrl } from '@/lib/stickers';
import { cn } from '@/lib/utils';
import { MessageTicks } from './MessageTicks';
import type { UiMessage } from '@galena/chat-core';
import { formatFullDateTime, formatTime } from '@galena/chat-core';

export interface StickerMessageProps {
  sticker: Sticker;
  message: UiMessage;
  own: boolean;
}

/**
 * A sticker without a bubble: at most 200 px on the chat background, with
 * the time and ticks overlaid in a small pill. The image loads from the
 * payload `url` only when it is on the same origin as the Galena API;
 * anything else shows a placeholder so a hostile sender cannot make every
 * viewer's browser fetch an arbitrary URL.
 */
export function StickerMessage({ sticker, message, own }: StickerMessageProps) {
  const [broken, setBroken] = useState(false);
  const trusted = isSameOriginStickerUrl(sticker.url);
  const alt = sticker.emoji !== undefined && sticker.emoji !== '' ? sticker.emoji : 'Sticker';
  const ratio = `${sticker.width} / ${sticker.height}`;

  return (
    <div className="relative inline-block max-w-[200px]">
      {trusted && !broken ? (
        <img
          src={sticker.url}
          alt={alt}
          loading="lazy"
          width={sticker.width}
          height={sticker.height}
          onError={() => setBroken(true)}
          style={{ aspectRatio: ratio }}
          className={cn('max-h-[200px] max-w-[200px] rounded-[8px] object-contain')}
        />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="flex h-[120px] w-[120px] items-center justify-center rounded-[8px] border border-edge bg-well text-[40px]"
        >
          {alt === 'Sticker' ? '🙂' : alt}
        </div>
      )}
      <span
        title={formatFullDateTime(message.createdAt)}
        className="raised-pill absolute right-1 bottom-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums"
      >
        {message.edited === true && <span>edited</span>}
        {formatTime(message.createdAt)}
        {own && <MessageTicks status={message.status} />}
      </span>
    </div>
  );
}
