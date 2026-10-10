import { Star } from 'lucide-react';
import { useAction } from '@/lib/effect/use-action';
import type { Sticker } from '@/lib/api';
import { type PageSetters, unstarSticker } from './pageActions';

/** One favorite sticker with its own Unfavorite action. */
export function FavoriteRow({ sticker, setters }: { sticker: Sticker; setters: PageSetters }) {
  const [, runUnstar] = useAction<void, void, never>(() => unstarSticker(sticker.id, setters));
  return (
    <li className="relative flex size-20 items-center justify-center justify-self-center overflow-hidden rounded-[10px] border border-border bg-surface p-1">
      <img
        src={sticker.url}
        alt={sticker.emoji ?? 'Sticker'}
        loading="lazy"
        width={72}
        height={72}
        className="max-h-full max-w-full object-contain"
      />
      <button
        type="button"
        aria-label={`Unfavorite ${sticker.emoji ?? 'sticker'}`}
        title={`Unfavorite ${sticker.emoji ?? 'sticker'}`}
        onClick={() => runUnstar()}
        className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full border border-edge bg-black/70 text-[10px] leading-none text-white"
      >
        <Star className="size-3 fill-current" aria-hidden="true" />
      </button>
    </li>
  );
}
