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
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { EMOJI_CATEGORIES, type EmojiCategoryId } from '@/lib/emoji-data';
import { cn } from '@/lib/utils';

/** The bar's height, the row the Search field swaps into. */
const EMOJI_CATEGORY_BAR_HEIGHT = 36;

const CATEGORY_ICONS: Record<EmojiCategoryId, LucideIcon> = {
  smileys: Smile,
  people: Hand,
  animals: PawPrint,
  food: Pizza,
  activities: Trophy,
  travel: Plane,
  objects: Lightbulb,
  symbols: Hash,
  flags: Flag,
};

type EmojiCategoryBarProps = {
  active: EmojiCategoryId | 'recent';
  /** Recent is shown only when the device has remembered emoji. */
  hasRecents: boolean;
  onSelect: (category: EmojiCategoryId | 'recent') => void;
  onOpenSearch: () => void;
};

/**
 * T-1946: one row of equal category buttons under the panel tabs, Search
 * first then Recent and the nine categories. The active button is raised, the
 * others draw muted; the bar stays put while the grid scrolls under it, as
 * Telegram and WhatsApp do.
 */
export function EmojiCategoryBar({
  active,
  hasRecents,
  onSelect,
  onOpenSearch,
}: EmojiCategoryBarProps) {
  return (
    <View
      accessibilityRole="toolbar"
      accessibilityLabel="Emoji categories"
      className="flex-row items-stretch justify-between"
      style={{ height: EMOJI_CATEGORY_BAR_HEIGHT }}
    >
      <BarButton label="Search emoji" icon={Search} onPress={onOpenSearch} />
      {hasRecents ? (
        <BarButton
          label="Recent emoji"
          icon={Clock}
          selected={active === 'recent'}
          onPress={() => onSelect('recent')}
        />
      ) : null}
      {EMOJI_CATEGORIES.map((category) => (
        <BarButton
          key={category.id}
          label={`${category.label} emoji`}
          icon={CATEGORY_ICONS[category.id]}
          selected={active === category.id}
          onPress={() => onSelect(category.id)}
        />
      ))}
    </View>
  );
}

function BarButton({
  label,
  icon: Icon,
  selected = false,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected ? { selected: true } : undefined}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      className={cn(
        'flex-1 items-center justify-center rounded-[8px] active:bg-surface-raised',
        selected && 'bg-surface-raised',
      )}
    >
      <Icon size={18} color={selected ? FOREGROUND : MUTED_FOREGROUND} />
    </Pressable>
  );
}
