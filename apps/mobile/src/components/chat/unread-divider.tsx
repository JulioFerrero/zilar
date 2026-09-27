import { View } from 'react-native';

import { Text } from '@/components/ui/text';

/** Full-width "Unread messages" bar shown above the first unread message. */
export function UnreadDivider() {
  return (
    <View className="my-2 w-full rounded-md bg-black/10 px-3 py-1 dark:bg-white/10">
      <Text className="text-center text-[12px] font-medium text-muted-foreground">
        Unread messages
      </Text>
    </View>
  );
}
