import type { ForwardOrigin } from '@zilar/protocol';
import { Forward } from 'lucide-react-native';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';

/** "Forwarded from X" header shown at the top of a forwarded bubble (T-0427). */
export function ForwardedHeader({ origin }: { origin: ForwardOrigin }) {
  const label =
    origin.chat_name === undefined
      ? `Forwarded from ${origin.sender_name}`
      : `Forwarded from ${origin.sender_name} in ${origin.chat_name}`;
  return (
    <View className="mb-1 flex-row items-center gap-1">
      <Forward size={13} color={MUTED_FOREGROUND} />
      <Text numberOfLines={1} className="shrink text-[12px] italic text-muted-foreground">
        {label}
      </Text>
    </View>
  );
}
