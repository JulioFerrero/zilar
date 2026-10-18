import { EMOJI_CATEGORIES, type EmojiCategoryId } from '@zilar/chat-core';
import {
  Clock,
  Flag,
  Hand,
  Hash,
  Lightbulb,
  PawPrint,
  Pizza,
  Plane,
  Search,
  Smile,
  Trophy,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** A section of the emoji scroller: the recents or one of the nine categories. */
export type EmojiSectionId = EmojiCategoryId | 'recent';

/** The phone's category icons (`apps/mobile/src/components/chat/emoji-tab.tsx`). */
const CATEGORY_ICONS: Record<EmojiCategoryId, LucideIcon> = {
  smileys: Smile,
  people: Hand,
  animals: PawPrint,
  food: Pizza,
  travel: Plane,
  activities: Trophy,
  objects: Lightbulb,
  symbols: Hash,
  flags: Flag,
};

interface EmojiCategoryBarProps {
  /** The section the scroller is on, or `undefined` before the first scroll. */
  active: EmojiSectionId | undefined;
  /** Whether the recents hold anything; the Recent key only shows when they do. */
  showRecent: boolean;
  onSelect: (section: EmojiSectionId) => void;
  onOpenSearch: () => void;
}

/**
 * T-1945: the emoji category bar, Telegram-style. Equal 32 px icon keys with
 * Search first, then Recent (only when there are recents) and the nine
 * categories. The active key is the D24 raised segment; the rest are muted.
 */
export function EmojiCategoryBar({
  active,
  showRecent,
  onSelect,
  onOpenSearch,
}: EmojiCategoryBarProps) {
  return (
    <div
      className="flex items-center justify-between gap-0.5"
      role="group"
      aria-label="Emoji categories"
    >
      <BarKey label="Search emoji" icon={Search} onPress={onOpenSearch} />
      {showRecent ? (
        <BarKey
          label="Recently used"
          icon={Clock}
          pressed={active === 'recent'}
          onPress={() => onSelect('recent')}
        />
      ) : null}
      {EMOJI_CATEGORIES.map(({ id, label }) => (
        <BarKey
          key={id}
          label={label}
          icon={CATEGORY_ICONS[id]}
          pressed={active === id}
          onPress={() => onSelect(id)}
        />
      ))}
    </div>
  );
}

function BarKey({
  label,
  icon: Icon,
  pressed,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  pressed?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onClick={onPress}
      className={
        pressed === true
          ? 'segment-raised flex h-8 w-8 shrink items-center justify-center rounded-[7px] text-foreground'
          : 'flex h-8 w-8 shrink items-center justify-center rounded-[7px] text-muted-foreground hover:text-foreground'
      }
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}
