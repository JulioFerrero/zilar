import { formatDateSeparator } from '@galena/chat-core';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { raisedPill } from '@/lib/depth';

/** Centered raised date pill: `Today`, `Yesterday`, `September 25`. */
export function DateSeparator({ date }: { date: Date }) {
  return (
    <View className="my-2 items-center">
      <View className="rounded-full px-2.5 py-1" style={raisedPill}>
        <Text className="text-[12px] font-medium text-muted-foreground">
          {formatDateSeparator(date, new Date())}
        </Text>
      </View>
    </View>
  );
}
