import { Effect } from 'effect';
import type { RecentStickerEntry } from '@/lib/stickers';
import { isPanelStickerUrl, readRecentStickers } from '@/lib/stickers';
import type { StickerChoice } from '../StickerPanel';

/**
 * A panel thumbnail: a same-origin sticker file URL loads lazily; anything
 * else (e.g. a hostile URL planted in localStorage recents) shows the
 * emoji tile so the browser never fetches it.
 */
export function StickerThumb({ sticker, size }: { sticker: StickerChoice; size: number }) {
  const trusted = isPanelStickerUrl(sticker.url);
  const label = sticker.emoji ?? 'Sticker';
  if (!trusted) {
    return (
      <span
        role="img"
        aria-label={label}
        className="flex items-center justify-center text-[26px]"
        style={{ width: size, height: size }}
      >
        {label === 'Sticker' ? '🙂' : label}
      </span>
    );
  }
  return (
    <img
      src={sticker.url}
      alt={label}
      loading="lazy"
      width={size}
      height={size}
      style={{ maxWidth: size, maxHeight: size }}
      className="object-contain"
    />
  );
}

/** The recents in localStorage at this sync edge; a blocked or hostile storage gives none. */
export function readStoredRecents(): RecentStickerEntry[] {
  return Effect.runSync(
    Effect.try(() => readRecentStickers(window.localStorage)).pipe(
      Effect.orElseSucceed((): RecentStickerEntry[] => []),
    ),
  );
}

/** The page's localStorage for a write, or null when the browser blocks it. */
export function panelStorage(): Storage | null {
  return Effect.runSync(
    Effect.try(() => window.localStorage).pipe(Effect.orElseSucceed((): Storage | null => null)),
  );
}
