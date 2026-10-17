import { searchEmoji } from '@zilar/chat-core';
import {
  Clock,
  Flag,
  Hand,
  Hash,
  Lightbulb,
  PawPrint,
  Pizza,
  Plane,
  Smile,
  Trophy,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { EMOJI_BY_CATEGORY, EMOJI_CATEGORIES, type EmojiCategoryId } from '@/lib/emoji-data';

/** Every glyph of every category, in category order; the search corpus. */
const ALL_EMOJI: readonly string[] = Object.values(EMOJI_BY_CATEGORY).flat();

const CATEGORY_ICONS: Record<EmojiCategoryId, typeof Smile> = {
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

type EmojiTabProps = {
  /** The sheet must be open for the body to render (tests hand `true`). */
  open: boolean;
  /** The last 24 used emoji (the composer loads them from device storage). */
  recents: readonly string[];
  /** The active category strip tab; the composer owns it for the session. */
  activeCategory: EmojiCategoryId | 'recent' | undefined;
  onSelectCategory: (category: EmojiCategoryId | 'recent' | undefined) => void;
  /** Tapping an emoji inserts it at the caret; the sheet stays open. */
  onPick: (emoji: string) => void;
};

/** How many emoji cells fit one row inside the sheet. */
export const EMOJI_GRID_COLUMNS = 8;

/**
 * The Emoji tab (T-0175): a category strip (Recent first, then the nine
 * categories) and a grid of plain-Unicode emoji. Tapping inserts at the
 * caret and never closes the sheet; a Lucide icon per category, emoji
 * characters only as emoji content.
 *
 * T-1660 adds a search field (in the body below): a non-empty query hides the
 * strip and filters every category by name. The query lives in the body, which
 * unmounts while the sheet is closed, so reopening starts on an empty query.
 */
export function EmojiTab({ open, ...props }: EmojiTabProps) {
  useSafeAreaInsets();
  if (!open) {
    return null;
  }
  return <EmojiTabBody {...props} />;
}

type EmojiTabBodyProps = Omit<EmojiTabProps, 'open'>;

function EmojiTabBody({ recents, activeCategory, onSelectCategory, onPick }: EmojiTabBodyProps) {
  const iconColor = ICON;
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const active: EmojiCategoryId | 'recent' =
    activeCategory ?? (recents.length > 0 ? 'recent' : 'smileys');
  const emoji =
    active === 'recent' ? recents : (EMOJI_BY_CATEGORY[active] ?? EMOJI_BY_CATEGORY.smileys);
  const list = searching ? searchEmoji(query, ALL_EMOJI) : emoji;
  return (
    <View className="flex min-h-0 flex-1 flex-col">
      <View className="p-2">
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search emoji"
          accessibilityLabel="Search emoji"
          onClear={() => setQuery('')}
        />
      </View>
      {searching ? null : (
        <ScrollView
          horizontal
          accessibilityRole="toolbar"
          accessibilityLabel="Emoji categories"
          // A horizontal ScrollView grows to fill the free height; without this
          // the category strip floats in a big empty gap under the tabs.
          style={{ flexGrow: 0 }}
          contentContainerStyle={{
            flexDirection: 'row',
            gap: 2,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          <CategoryButton
            label="Recent emoji"
            selected={active === 'recent'}
            onPress={() => onSelectCategory('recent')}
            icon={<Clock size={18} color={iconColor} />}
          />
          {EMOJI_CATEGORIES.map((category) => {
            const Icon = CATEGORY_ICONS[category.id];
            return (
              <CategoryButton
                key={category.id}
                label={`${category.label} emoji`}
                selected={active === category.id}
                onPress={() => onSelectCategory(category.id)}
                icon={<Icon size={18} color={iconColor} />}
              />
            );
          })}
        </ScrollView>
      )}
      {list.length === 0 ? (
        <View className="h-[180px] items-center justify-center px-4">
          <Text className="text-center text-[13px] text-muted-foreground">
            {searching ? 'No emoji found.' : 'Tap an emoji below to keep it here.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          accessibilityLabel="Emoji grid"
          className="min-h-0 flex-1"
          contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 8 }}
        >
          {list.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${item}`}
              onPress={() => onPick(item)}
              className="items-center justify-center rounded-[8px] active:bg-surface-raised"
              style={{ width: `${100 / EMOJI_GRID_COLUMNS}%`, aspectRatio: 1 }}
            >
              <Text className="text-[26px]">{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function CategoryButton({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      className="shrink-0 items-center justify-center rounded-[8px] p-2 active:bg-surface-raised"
    >
      {icon}
    </Pressable>
  );
}
