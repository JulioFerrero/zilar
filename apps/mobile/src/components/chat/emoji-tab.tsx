import { searchEmoji } from '@zilar/chat-core';
import {
  X,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  View,
} from 'react-native';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND, FOREGROUND } from '@/lib/colors';
import { EMOJI_BY_CATEGORY, type EmojiCategoryId, EMOJI_CATEGORIES } from '@/lib/emoji-data';
import { cn } from '@/lib/utils';

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
  hasRecents: boolean;
  onSelect: (category: EmojiCategoryId | 'recent') => void;
  onOpenSearch: () => void;
};

function EmojiCategoryBar({ active, hasRecents, onSelect, onOpenSearch }: EmojiCategoryBarProps) {
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

type EmojiSectionCategory = 'recent' | EmojiCategoryId;

interface EmojiHeaderItem {
  kind: 'header';
  key: string;
  category: EmojiSectionCategory;
  label: string;
}

interface EmojiRowItem {
  kind: 'row';
  key: string;
  category?: EmojiSectionCategory;
  glyphs: string[];
}

type EmojiListItem = EmojiHeaderItem | EmojiRowItem;

interface EmojiRows {
  items: EmojiListItem[];
  headerIndex: Partial<Record<EmojiSectionCategory, number>>;
}

function chunk<T>(items: readonly T[], columns: number): T[][] {
  if (columns <= 0) {
    return [];
  }
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += columns) {
    rows.push(items.slice(start, start + columns));
  }
  return rows;
}

function buildEmojiRows(recents: readonly string[], columns: number): EmojiRows {
  const items: EmojiListItem[] = [];
  const headerIndex: Partial<Record<EmojiSectionCategory, number>> = {};

  const addSection = (
    category: EmojiSectionCategory,
    label: string,
    glyphs: readonly string[],
  ): void => {
    if (glyphs.length === 0) {
      return;
    }
    headerIndex[category] = items.length;
    items.push({ kind: 'header', key: `header-${category}`, category, label });
    chunk(glyphs, columns).forEach((row, rowIndex) => {
      items.push({
        kind: 'row',
        key: `${category}-row-${rowIndex}`,
        category,
        glyphs: row,
      });
    });
  };

  addSection('recent', 'Recently used', recents);
  for (const category of EMOJI_CATEGORIES) {
    addSection(category.id, category.label, EMOJI_BY_CATEGORY[category.id]);
  }

  return { items, headerIndex };
}

function buildSearchRows(results: readonly string[], columns: number): EmojiRowItem[] {
  return chunk(results, columns).map((glyphs, index) => ({
    kind: 'row',
    key: `search-row-${index}`,
    glyphs,
  }));
}

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
