import { Pencil, X } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { well } from '@/lib/depth';

/**
 * The composer's edit bar (T-0085): names the action, shows the original
 * message text and closes with the × button. Mirrors the web `EditBar.tsx`.
 */
export function EditBar({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <View className="mb-2 flex-row items-stretch overflow-hidden rounded-[10px]" style={well}>
      <View className="w-[3px] bg-[#333333]" />
      <View className="min-w-0 flex-1 px-2.5 py-1.5">
        <View className="flex-row items-center gap-1.5">
          <Pencil size={14} color="#d4d4d4" />
          <Text className="text-[13px] font-semibold text-[#d4d4d4]">Edit message</Text>
        </View>
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          {text}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel edit"
        onPress={onCancel}
        className="w-9 items-center justify-center active:bg-surface-raised"
      >
        <X size={18} color={ICON} />
      </Pressable>
    </View>
  );
}
