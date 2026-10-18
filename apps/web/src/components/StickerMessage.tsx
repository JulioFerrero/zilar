import { useState } from 'react';
import { Smile } from 'lucide-react';
import { Link } from 'react-router';
import type { Sticker } from '@zilar/protocol';
import { isSameOriginStickerUrl } from '@/lib/stickers';
import { cn } from '@/lib/utils';
import { MessageTicks } from './MessageTicks';
import type { UiMessage } from '@zilar/chat-core';
import { formatFullDateTime, formatTime } from '@zilar/chat-core';

export interface StickerMessageProps {
  sticker: Sticker;
  message: UiMessage;
  own: boolean;
  selecting?: boolean;
}

/**
 * Loads the image only from the API's own origin; anything else shows a
 * placeholder so a hostile sender cannot make viewers fetch an arbitrary URL.
 */
export function StickerMessage({ sticker, message, own, selecting = false }: StickerMessageProps) {
  const [broken, setBroken] = useState(false);
  const trusted = isSameOriginStickerUrl(sticker.url);
  const alt = sticker.emoji !== undefined && sticker.emoji !== '' ? sticker.emoji : 'Sticker';
  const ratio = `${sticker.width} / ${sticker.height}`;
  const image =
    trusted && !broken ? (
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
        {alt === 'Sticker' ? (
          <Smile className="size-10 text-muted-foreground" aria-hidden="true" />
        ) : (
          alt
        )}
      </div>
    );

  return (
    <div className="relative inline-block max-w-[200px]">
      {selecting ? (
        <div className="block">{image}</div>
      ) : (
        <Link
          to={`/stickers/${sticker.pack_id}`}
          aria-label="Open sticker pack"
          className="block cursor-pointer"
        >
          {image}
        </Link>
      )}
      <span
        title={formatFullDateTime(message.createdAt)}
        className="raised-pill absolute right-1 bottom-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground tabular-nums"
      >
        {message.edited === true && message.editedAt !== undefined ? (
          <span>edited {formatTime(message.editedAt)}</span>
        ) : (
          <>
            {message.edited === true && <span>edited</span>}
            {formatTime(message.createdAt)}
          </>
        )}
        {own && <MessageTicks status={message.status} />}
      </span>
    </div>
  );
}
