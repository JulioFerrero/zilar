import { ScrollView, View } from 'react-native';
import { Pressable } from 'react-native';

import { Text } from '@/components/ui/text';
import { CHAT_FOLDERS } from '@/lib/filter';
import type { ChatFolder } from '@/lib/types';
import { cn } from '@/lib/utils';

type FolderTabsProps = {
  activeFolder: ChatFolder;
  counts: Record<ChatFolder, number>;
  onSelect: (folder: ChatFolder) => void;
};

/** Scrollable folder tabs with the accent underline from ui-style.md §4. */
export function FolderTabs({ activeFolder, counts, onSelect }: FolderTabsProps) {
  return (
    <View className="border-b border-divider bg-background">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-6 px-4"
      >
        {CHAT_FOLDERS.map((folder) => {
          const selected = folder.key === activeFolder;
          const count = counts[folder.key];
          return (
            <Pressable
              key={folder.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={folder.label}
              onPress={() => onSelect(folder.key)}
              className="pt-1.5"
            >
              <View className="flex-row items-center gap-1.5">
                <Text
                  className={cn(
                    'text-[15px] font-medium',
                    selected ? 'text-accent' : 'text-muted-foreground',
                  )}
                >
                  {folder.label}
                </Text>
                {count > 0 ? (
                  <View
                    className={cn(
                      'h-[18px] min-w-[18px] items-center justify-center rounded-full px-1',
                      selected ? 'bg-accent' : 'bg-badge-muted',
                    )}
                  >
                    <Text className="text-[11px] font-semibold text-white">{count}</Text>
                  </View>
                ) : null}
              </View>
              <View
                className={cn(
                  'mt-1 h-[3px] rounded-full',
                  selected ? 'bg-accent' : 'bg-transparent',
                )}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
