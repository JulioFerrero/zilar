import { formatDateSeparator } from '@galena/chat-core';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';

/** Centered translucent date pill: `Today`, `Yesterday`, `September 25`. */
export function DateSeparator({ date }: { date: Date }) {
  return (
    <View className="my-2 items-center">
      <View className="rounded-full bg-black/25 px-3 py-1">
        <Text className="text-[13px] font-semibold text-white">
          {formatDateSeparator(date, new Date())}
        </Text>
      </View>
    </View>
  );
}
