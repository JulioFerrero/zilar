import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { well } from '@/lib/depth';

/** Full-width well strip shown above the first unread message. */
export function UnreadDivider() {
  return (
    <View className="my-3 w-full px-3">
      <View className="w-full rounded-[10px] px-3 py-1.5" style={well}>
        <Text className="text-center text-[12px] font-medium text-muted-foreground">
          Unread messages
        </Text>
      </View>
    </View>
  );
}
