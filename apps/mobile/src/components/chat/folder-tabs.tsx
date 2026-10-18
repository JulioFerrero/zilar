import type { ChatFolder } from '@zilar/chat-core';
import { MessagesSquare } from 'lucide-react-native';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { segment, well } from '@/lib/depth';
import { cn } from '@/lib/utils';

import { folderIcon } from './folder-icon';

/** How far the chip row is inset, used to keep the active chip in view. */
const ROW_INSET = 16;

/** The well track's inner padding, as in the kit segmented control. */
const TRACK_PADDING = 3;

type FolderChip = {
  id: string;
  name: string;
  folder: ChatFolder | undefined;
};

type FolderTabsProps = {
  /** 'all' or a folder id. */
  activeFolder: string;
  folders: ChatFolder[];
  /** Unread totals keyed by 'all' or a folder id. */
  counts: Record<string, number>;
  /** The pager's continuous page position; drives the raised chip. */
  progress: SharedValue<number>;
  onSelect: (folder: string) => void;
};

/** The chip's glyph: the folder's icon, or the all-chats square for "all". */
function chipGlyph(folder: ChatFolder | undefined, color: string) {
  if (folder === undefined) {
    return <MessagesSquare size={14} color={color} />;
  }
  const Icon = folderIcon(folder.icon);
  return <Icon size={14} color={color} />;
}

/**
 * The chat folders as a scrollable segmented track (T-0248, T-1965): "All
 * chats" first, then one chip per server folder, on the kit's recessed `well`
 * track. The selected chip is raised (the `segment` look); a chip shows its
 * unread count only when it is above zero. T-1310: the raised layer cross-fades
 * with the pager's `progress`, so the indicator follows a swipe, and the row
 * scrolls to keep the active chip in view as the pager turns.
 */
export function FolderTabs({ activeFolder, folders, counts, progress, onSelect }: FolderTabsProps) {
  const chips: FolderChip[] = [
    { id: 'all', name: 'All chats', folder: undefined },
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, folder })),
  ];
  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef<Record<string, { x: number; width: number }>>({});

  const scrollToActive = useCallback((id: string) => {
    const position = positions.current[id];
    if (position !== undefined) {
      scrollRef.current?.scrollTo({
        x: Math.max(0, position.x - TRACK_PADDING),
        animated: true,
      });
    }
  }, []);

  useEffect(() => {
    scrollToActive(activeFolder);
  }, [activeFolder, scrollToActive]);

  const recordLayout = (chip: FolderChip, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    positions.current[chip.id] = { x, width };
    if (chip.id === activeFolder) {
      scrollToActive(chip.id);
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      // A horizontal ScrollView grows to fill the free height; without this it
      // floats in a big empty gap above the list.
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        flexDirection: 'row',
        paddingHorizontal: ROW_INSET,
        paddingBottom: 8,
      }}
    >
      <View
        className="flex-row gap-0.5 rounded-[10px] p-[3px]"
        style={[well, { borderColor: '#1a1a1a' }]}
      >
        {chips.map((chip, index) => (
          <FolderChipView
            key={chip.id}
            chip={chip}
            index={index}
            selected={chip.id === activeFolder}
            count={counts[chip.id] ?? 0}
            progress={progress}
            onSelect={() => onSelect(chip.id)}
            onLayout={(event) => recordLayout(chip, event)}
          />
        ))}
      </View>
    </ScrollView>
  );
}

type FolderChipViewProps = {
  chip: FolderChip;
  index: number;
  selected: boolean;
  count: number;
  progress: SharedValue<number>;
  onSelect: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
};

/** One chip: the raised `segment` layer sits on the well track and cross-fades. */
function FolderChipView({
  chip,
  index,
  selected,
  count,
  progress,
  onSelect,
  onLayout,
}: FolderChipViewProps) {
  const raisedStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - Math.abs(progress.value - index)),
  }));
  const iconColor = selected ? FOREGROUND : MUTED_FOREGROUND;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={chip.name}
      onPress={onSelect}
      onLayout={onLayout}
      className="h-[34px] flex-row items-center gap-1.5 overflow-hidden rounded-[7px] px-3"
    >
      <Animated.View
        className="absolute inset-0 rounded-[7px]"
        style={[segment, raisedStyle]}
        pointerEvents="none"
      />
      {chipGlyph(chip.folder, iconColor)}
      <Text
        className={cn(
          'text-[13px] font-medium',
          selected ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {chip.name}
      </Text>
      {count > 0 ? (
        <View
          className={cn(
            'min-w-[16px] items-center justify-center rounded-full px-1',
            selected ? 'bg-accent' : 'bg-surface',
          )}
        >
          <Text
            className={cn(
              'font-mono text-[10px] leading-4',
              selected ? 'text-accent-foreground' : 'text-muted-foreground',
            )}
          >
            {count}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
