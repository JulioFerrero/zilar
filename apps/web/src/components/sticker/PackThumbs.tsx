import type { StickerPack } from '@/lib/api';

export interface PackRowThumb {
  url: string;
  alt: string;
}

/** A pack row's thumbnail strip: the first few sticker images, side by side. */
export function PackThumbs({ thumbs }: { thumbs: PackRowThumb[] }) {
  if (thumbs.length === 0) {
    return (
      <span className="flex size-14 shrink-0 items-center justify-center rounded-[10px] bg-surface-raised text-[20px]">
        🙂
      </span>
    );
  }
  return (
    <span className="flex shrink-0 -space-x-3">
      {thumbs.map((thumb, index) => (
        <img
          key={`${index}-${thumb.url}`}
          src={thumb.url}
          alt={thumb.alt}
          loading="lazy"
          width={56}
          height={56}
          className="size-14 rounded-[10px] border border-edge bg-surface object-contain"
        />
      ))}
    </span>
  );
}

export function thumbsOf(pack: StickerPack): PackRowThumb[] {
  return pack.stickers.slice(0, 5).map((sticker, index) => ({
    url: sticker.url,
    alt: sticker.emoji ?? `Sticker ${index + 1}`,
  }));
}

export type VisibilityBadge = 'Shared' | 'Private';

export function VisibilityBadge({ label }: { label: VisibilityBadge }) {
  return (
    <span
      className={
        label === 'Shared'
          ? 'rounded-full bg-accent px-2 py-0.5 text-[12px] font-medium text-accent-foreground'
          : 'rounded-full bg-surface-raised px-2 py-0.5 text-[12px] text-muted-foreground'
      }
    >
      {label}
    </span>
  );
}
