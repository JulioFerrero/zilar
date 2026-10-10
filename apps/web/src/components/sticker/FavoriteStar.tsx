import { Effect } from 'effect';
import { Star } from 'lucide-react';
import { addStickerFavorite, removeStickerFavorite } from '@/lib/api';
import { fromApi } from '@/lib/effect/api-effect';
import { useAction } from '@/lib/effect/use-action';
import { cn } from '@/lib/utils';
import type { StickerChoice } from '../StickerPanel';

/**
 * The favorite star on one sticker tile (T-0121). It has its own action, so a
 * second click on the same star waits for the first request while other stars
 * run at once. The request is uninterruptible: a row leaves the list at once
 * when its favorite is removed on the Favorites tab, and a failed request must
 * still roll back.
 */
export function FavoriteStar({
  sticker,
  starred,
  onApply,
  onUndo,
}: {
  sticker: StickerChoice;
  starred: boolean;
  onApply: (sticker: StickerChoice, wasStarred: boolean) => void;
  onUndo: (sticker: StickerChoice, wasStarred: boolean) => void;
}) {
  const [, toggle] = useAction((wasStarred: boolean) =>
    Effect.sync(() => onApply(sticker, wasStarred)).pipe(
      Effect.andThen(
        Effect.uninterruptible(
          (wasStarred
            ? fromApi(() => removeStickerFavorite(sticker.stickerId))
            : fromApi(() => addStickerFavorite(sticker.stickerId))
          ).pipe(Effect.tapError(() => Effect.sync(() => onUndo(sticker, wasStarred)))),
        ),
      ),
    ),
  );

  return (
    <button
      type="button"
      aria-label={
        starred
          ? `Unfavorite ${sticker.emoji ?? 'sticker'}`
          : `Favorite ${sticker.emoji ?? 'sticker'}`
      }
      aria-pressed={starred}
      title={starred ? 'Remove from favorites' : 'Add to favorites'}
      onClick={() => toggle(starred)}
      className={cn(
        'absolute top-0.5 right-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-edge bg-black/70 text-[10px] leading-none',
        starred ? 'text-white' : 'text-muted-foreground opacity-80',
      )}
    >
      <Star className={cn('size-3', starred && 'fill-current')} aria-hidden="true" />
    </button>
  );
}
