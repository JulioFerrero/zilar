import { Smile } from 'lucide-react';
import type { StickerPack } from '@/lib/api';

export interface PackRowThumb {
  url: string;
  alt: string;
}

const DEFAULT_SIZE = 56;
const SMALL_SIZE = 36;
const THUMB_COUNT = 4;

export function PackThumbs({
  thumbs,
  size = DEFAULT_SIZE,
}: {
  thumbs: PackRowThumb[];
  size?: number;
}) {
  const radius = size > SMALL_SIZE ? 10 : 8;
  if (thumbs.length === 0) {
    return (
      <span
        className="flex shrink-0 items-center justify-center bg-surface-raised"
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <Smile
          className="text-muted-foreground"
          style={{ width: size * 0.43, height: size * 0.43 }}
          aria-hidden="true"
        />
      </span>
    );
  }
  return (
    <span className="flex shrink-0 gap-1">
      {thumbs.map((thumb, index) => (
        <img
          key={`${index}-${thumb.url}`}
          src={thumb.url}
          alt={thumb.alt}
          loading="lazy"
          width={size}
          height={size}
          className="border border-edge bg-surface object-contain"
          style={{ width: size, height: size, borderRadius: radius }}
        />
      ))}
    </span>
  );
}

export function thumbsOf(pack: StickerPack): PackRowThumb[] {
  return pack.stickers.slice(0, THUMB_COUNT).map((sticker, index) => ({
    url: sticker.url,
    alt: sticker.emoji ?? `Sticker ${index + 1}`,
  }));
}
