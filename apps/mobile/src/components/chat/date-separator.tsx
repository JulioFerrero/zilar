import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { formatDateSeparator } from '@/lib/time';

/** Centered translucent date pill: `Today`, `Yesterday`, `September 25`. */
export function DateSeparator({ iso }: { iso: string }) {
  return (
    <View className="my-2 items-center">
      <View className="rounded-full bg-black/25 px-3 py-1">
        <Text className="text-[13px] font-semibold text-white">
          {formatDateSeparator(iso, new Date())}
        </Text>
      </View>
    </View>
  );
}
