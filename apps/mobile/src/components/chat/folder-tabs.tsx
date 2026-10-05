import type { ChatFolder } from '@zilar/chat-core';
import { MessagesSquare } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { FOREGROUND, MUTED_FOREGROUND } from '@/lib/colors';
import { segment } from '@/lib/depth';
import { cn } from '@/lib/utils';

import { folderIcon } from './folder-icon';

type FolderTabsProps = {
  /** 'all' or a folder id. */
  activeFolder: string;
  folders: ChatFolder[];
  /** Unread totals keyed by 'all' or a folder id. */
  counts: Record<string, number>;
  onSelect: (folder: string) => void;
};

/**
 * The chat folders as scrollable chips (T-0248): "All chats" first, then one
 * chip per server folder. The selected chip is raised (the `segment` look) and
 * the rest are muted; a chip shows its unread count only when it is above zero.
 */
export function FolderTabs({ activeFolder, folders, counts, onSelect }: FolderTabsProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const chips = [
    { id: 'all', name: 'All chats', folder: undefined as ChatFolder | undefined },
    ...folders.map((folder) => ({ id: folder.id, name: folder.name, folder })),
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // A horizontal ScrollView grows to fill the free height; without this it
      // floats in a big empty gap above the list.
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 16,
        paddingBottom: 8,
      }}
    >
      {chips.map((chip) => {
        const selected = chip.id === activeFolder;
        const count = counts[chip.id] ?? 0;
        const Icon = chip.folder === undefined ? MessagesSquare : folderIcon(chip.folder.icon);
        const iconColor = selected ? FOREGROUND[scheme] : MUTED_FOREGROUND[scheme];
        return (
          <Pressable
            key={chip.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={chip.name}
            onPress={() => onSelect(chip.id)}
            className={cn(
              'h-[34px] flex-row items-center gap-1.5 rounded-full px-3',
              selected ? '' : 'bg-surface',
            )}
            style={selected ? segment : undefined}
          >
            <Icon size={14} color={iconColor} />
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
      })}
    </ScrollView>
  );
}
