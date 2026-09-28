import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { segment, well } from '@/lib/depth';
import { CHAT_FOLDERS } from '@/lib/filter';
import type { ChatFolder } from '@/lib/types';
import { cn } from '@/lib/utils';

type FolderTabsProps = {
  activeFolder: ChatFolder;
  counts: Record<ChatFolder, number>;
  onSelect: (folder: ChatFolder) => void;
};

/** Folder segmented control: a well track with the active tab raised (ui-style.md §5). */
export function FolderTabs({ activeFolder, counts, onSelect }: FolderTabsProps) {
  return (
    <View
      className="mx-4 mb-2 flex-row gap-0.5 rounded-xl p-[3px]"
      style={[well, { borderColor: '#1a1a1a' }]}
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
            className="h-[34px] flex-1 flex-row items-center justify-center gap-1 rounded-[9px]"
            style={selected ? segment : undefined}
          >
            <Text
              className={cn(
                'text-[13px] font-medium',
                selected ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {folder.label}
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
    </View>
  );
}
