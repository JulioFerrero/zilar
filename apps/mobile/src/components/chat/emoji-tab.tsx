import { searchEmoji } from '@zilar/chat-core';
import { X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  View,
} from 'react-native';

import { EmojiCategoryBar } from '@/components/chat/emoji-category-bar';
import {
  buildEmojiRows,
  buildSearchRows,
  type EmojiListItem,
  type EmojiRowItem,
  type EmojiSectionCategory,
} from '@/components/chat/emoji-rows';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { EMOJI_BY_CATEGORY, type EmojiCategoryId } from '@/lib/emoji-data';

/** Every glyph of every category, in category order; the search corpus. */
const ALL_EMOJI: readonly string[] = Object.values(EMOJI_BY_CATEGORY).flat();

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

/** A category header's fixed height, so `getItemLayout` stays exact. */
const HEADER_HEIGHT = 28;

/** The section the panel opens on: the remembered one, else the first filled. */
function resolveInitialCategory(
  category: EmojiCategoryId | 'recent' | undefined,
  recents: readonly string[],
): EmojiSectionCategory {
  if (category === 'recent' && recents.length === 0) {
    return 'smileys';
  }
  if (category === undefined) {
    return recents.length > 0 ? 'recent' : 'smileys';
  }
  return category;
}

/**
 * The Emoji tab (T-0175, reworked by T-1946): one continuous list of every
 * emoji with a header per category, a bar that follows the scroll and jumps to
 * a category when tapped. Search swaps the bar for a field in place. Tapping
 * inserts at the caret and never closes the sheet; Lucide icons for chrome,
 * emoji characters only as emoji content.
 */
export function EmojiTab({ open, ...props }: EmojiTabProps) {
  if (!open) {
    return null;
  }
  return <EmojiTabBody {...props} />;
}

type EmojiTabBodyProps = Omit<EmojiTabProps, 'open'>;

function EmojiTabBody({ recents, activeCategory, onSelectCategory, onPick }: EmojiTabBodyProps) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [width, setWidth] = useState(0);

  // A pick records a recent in the composer, but the open list must not
  // reorder under the finger: it freezes the recents it opened with and the
  // next open rebuilds from the stored ones.
  const [initialRecents] = useState(recents);
  const initialCategory = resolveInitialCategory(activeCategory, initialRecents);
  const [active, setActive] = useState<EmojiSectionCategory>(initialCategory);
  const activeRef = useRef(active);

  const { items, headerIndex } = useMemo(
    () => buildEmojiRows(initialRecents, EMOJI_GRID_COLUMNS),
    [initialRecents],
  );

  const searching = query.trim() !== '';
  const results = useMemo(
    () => (searching ? searchEmoji(query, ALL_EMOJI) : []),
    [query, searching],
  );
  const searchRows = useMemo(() => buildSearchRows(results, EMOJI_GRID_COLUMNS), [results]);

  const cell = width / EMOJI_GRID_COLUMNS;

  const categoryLayouts = useMemo(() => {
    const lengths = items.map((item) => (item.kind === 'header' ? HEADER_HEIGHT : cell));
    return lengths.map((length, index) => ({
      index,
      length,
      offset: lengths.slice(0, index).reduce((sum, itemLength) => sum + itemLength, 0),
    }));
  }, [items, cell]);

  const listRef = useRef<FlatList<EmojiListItem>>(null);
  const onSelectCategoryRef = useRef(onSelectCategory);
  useEffect(() => {
    onSelectCategoryRef.current = onSelectCategory;
  }, [onSelectCategory]);

  // The bar follows the first viewable item. The handler must keep one
  // identity for the list's lifetime, so it reads the live callback from a ref.
  const handleViewableItemsChanged = useCallback(
    (info: { viewableItems: { item: EmojiListItem }[] }) => {
      const category = info.viewableItems[0]?.item.category;
      if (category === undefined || activeRef.current === category) {
        return;
      }
      activeRef.current = category;
      setActive(category);
      onSelectCategoryRef.current(category);
    },
    [],
  );
  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 10 }), []);

  const selectCategory = (category: EmojiCategoryId | 'recent'): void => {
    activeRef.current = category;
    setActive(category);
    const index = headerIndex[category];
    if (index !== undefined) {
      listRef.current?.scrollToIndex({ index, animated: false });
    }
    onSelectCategory(category);
  };

  const handleLayout = (event: LayoutChangeEvent): void => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (current === next ? current : next));
  };

  const closeSearch = (): void => {
    setSearchOpen(false);
    setQuery('');
  };

  const renderCategoryItem = ({ item }: ListRenderItemInfo<EmojiListItem>) => {
    if (item.kind === 'header') {
      return (
        <View style={{ height: HEADER_HEIGHT }} className="justify-center px-1">
          <Text className="text-[12px] font-semibold text-muted-foreground">{item.label}</Text>
        </View>
      );
    }
    return <EmojiRow glyphs={item.glyphs} cell={cell} onPick={onPick} />;
  };

  const renderSearchItem = ({ item }: ListRenderItemInfo<EmojiRowItem>) => (
    <EmojiRow glyphs={item.glyphs} cell={cell} onPick={onPick} />
  );

  return (
    <View className="flex min-h-0 flex-1 flex-col">
      <View className="pb-2">
        {searchOpen ? (
          <View className="flex-row items-center gap-2">
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search emoji"
              accessibilityLabel="Search emoji"
              autoFocus
              containerClassName="h-9 min-h-9 flex-1"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close emoji search"
              hitSlop={8}
              onPress={closeSearch}
              className="h-9 w-9 items-center justify-center rounded-[8px] active:bg-surface-raised"
            >
              <X size={18} color={MUTED_FOREGROUND} />
            </Pressable>
          </View>
        ) : (
          <EmojiCategoryBar
            active={active}
            hasRecents={initialRecents.length > 0}
            onSelect={selectCategory}
            onOpenSearch={() => setSearchOpen(true)}
          />
        )}
      </View>
      <View className="min-h-0 flex-1" onLayout={handleLayout}>
        {width === 0 ? null : searching ? (
          results.length === 0 ? (
            <NoResults />
          ) : (
            <FlatList
              key="emoji-search"
              data={searchRows}
              keyExtractor={(item) => item.key}
              renderItem={renderSearchItem}
              getItemLayout={(_data, index) => ({
                index,
                length: cell,
                offset: cell * index,
              })}
              keyboardShouldPersistTaps="handled"
              className="flex-1"
            />
          )
        ) : (
          <FlatList
            key="emoji-all"
            ref={listRef}
            data={items}
            keyExtractor={(item) => item.key}
            renderItem={renderCategoryItem}
            getItemLayout={(_data, index) =>
              categoryLayouts[index] ?? { index, length: 0, offset: 0 }
            }
            initialScrollIndex={headerIndex[active] ?? 0}
            initialNumToRender={10}
            windowSize={5}
            onViewableItemsChanged={handleViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            keyboardShouldPersistTaps="handled"
            className="flex-1"
          />
        )}
      </View>
    </View>
  );
}

function EmojiRow({
  glyphs,
  cell,
  onPick,
}: {
  glyphs: string[];
  cell: number;
  onPick: (emoji: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', height: cell }}>
      {glyphs.map((glyph) => (
        <Pressable
          key={glyph}
          accessibilityRole="button"
          accessibilityLabel={`Insert ${glyph}`}
          onPress={() => onPick(glyph)}
          className="items-center justify-center rounded-[8px] active:bg-surface-raised"
          style={{ width: cell, height: cell }}
        >
          <Text className="text-[28px]">{glyph}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function NoResults() {
  return (
    <View className="flex-1 items-center justify-center px-4">
      <Text className="text-center text-[13px] text-muted-foreground">No emoji found.</Text>
    </View>
  );
}
