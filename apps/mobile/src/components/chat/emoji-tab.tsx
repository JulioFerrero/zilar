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

const ALL_EMOJI: readonly string[] = Object.values(EMOJI_BY_CATEGORY).flat();

type EmojiTabProps = {
  open: boolean;
  recents: readonly string[];
  activeCategory: EmojiCategoryId | 'recent' | undefined;
  onSelectCategory: (category: EmojiCategoryId | 'recent' | undefined) => void;
  onPick: (emoji: string) => void;
};

export const EMOJI_GRID_COLUMNS = 8;

/** Fixed header height, so `getItemLayout` stays exact. */
const HEADER_HEIGHT = 28;

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

  // The open list freezes the recents it opened with, so a pick never reorders
  // under the finger; the next open rebuilds from storage.
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

  // The handler keeps one identity for the list's lifetime, so it reads the live callback from a ref.
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
