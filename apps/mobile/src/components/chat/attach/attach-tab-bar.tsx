import { File as FileIcon, Image as ImageIcon } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { segment } from '@/lib/depth';

/** The two tabs of the attach sheet (T-1320): the inline gallery and files. */
export type AttachTab = 'gallery' | 'file';

const TABS: { id: AttachTab; label: string; Icon: LucideIcon }[] = [
  { id: 'gallery', label: 'Gallery', Icon: ImageIcon },
  { id: 'file', label: 'File', Icon: FileIcon },
];

/**
 * The sheet's bottom tab bar: Gallery | File, lucide icons, and the active
 * pill look of the main floating tab bar (`segment`). The face is keyed by its
 * look, so Android rebuilds it instead of swapping the gradient on a live view
 * (`gradient-swap.test.ts`).
 */
export function AttachTabBar({
  active,
  onSelect,
}: {
  active: AttachTab;
  onSelect: (tab: AttachTab) => void;
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel="Attachment tabs"
      className="flex-row gap-1 border-t border-divider pt-2"
    >
      {TABS.map(({ id, label, Icon }) => {
        const selected = active === id;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => onSelect(id)}
            className="flex-1 items-center justify-center rounded-[10px] py-1 active:bg-surface-raised"
          >
            <View
              key={selected ? 'active' : 'idle'}
              className="flex-row items-center gap-1.5 rounded-[8px] px-3 py-1.5"
              {...(selected ? { style: segment } : {})}
            >
              <Icon size={16} color={selected ? '#ededed' : ICON} />
              <Text
                className="text-[13px] font-medium"
                style={{ color: selected ? '#ededed' : MUTED_FOREGROUND }}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
