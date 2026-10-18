import { useState } from 'react';
import { Effect } from 'effect';
import { Smile } from 'lucide-react';
import type { RecentStickerEntry } from '@/lib/stickers';
import { isPanelStickerUrl, readRecentStickers } from '@/lib/stickers';
import type { StickerChoice } from '../StickerPanel';

/**
 * A same-origin sticker file URL loads lazily; anything else (e.g. a hostile
 * URL planted in localStorage recents) shows the emoji tile so the browser
 * never fetches it.
 */
export function StickerThumb({
  sticker,
  size,
  onBroken,
}: {
  sticker: StickerChoice;
  size: number;
  onBroken?: (() => void) | undefined;
}) {
  const [broken, setBroken] = useState(false);
  const trusted = isPanelStickerUrl(sticker.url);
  const label = sticker.emoji ?? 'Sticker';
  if (!trusted || broken) {
    return (
      <span
        role="img"
        aria-label={label}
        className="flex items-center justify-center text-[26px]"
        style={{ width: size, height: size }}
      >
        {label === 'Sticker' ? (
          <Smile className="size-6 text-muted-foreground" aria-hidden="true" />
        ) : (
          label
        )}
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
      onError={() => {
        setBroken(true);
        onBroken?.();
      }}
    />
  );
}

export function readStoredRecents(): RecentStickerEntry[] {
  return Effect.runSync(
    Effect.try(() => readRecentStickers(window.localStorage)).pipe(
      Effect.orElseSucceed((): RecentStickerEntry[] => []),
    ),
  );
}

export function panelStorage(): Storage | null {
  return Effect.runSync(
    Effect.try(() => window.localStorage).pipe(Effect.orElseSucceed((): Storage | null => null)),
  );
}
