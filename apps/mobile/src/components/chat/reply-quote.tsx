import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ReplyRef } from '@/lib/types';

/** Quoted reply block at the top of a bubble: a `#333` bar and a muted excerpt. */
export function ReplyQuote({ reply }: { reply: ReplyRef }) {
  return (
    <View className="mb-1 flex-row overflow-hidden rounded-md bg-surface">
      <View className="w-[3px] bg-[#333333]" />
      <View className="min-w-0 flex-1 px-2 py-1">
        <Text className="text-[13px] font-semibold" color="#d4d4d4">
          {reply.senderName}
        </Text>
        {reply.text !== undefined ? (
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {reply.text}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
