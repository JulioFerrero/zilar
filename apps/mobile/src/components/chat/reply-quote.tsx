import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { ReplyRef } from '@/lib/types';

/** Quoted reply block at the top of a bubble. */
export function ReplyQuote({ reply }: { reply: ReplyRef }) {
  return (
    <View className="mb-1 flex-row overflow-hidden rounded-md bg-black/5">
      <View className="w-[3px] bg-accent" />
      <View className="flex-1 px-2 py-1">
        <Text className="text-[13px] font-semibold text-accent">{reply.senderName}</Text>
        {reply.text !== undefined ? (
          <Text numberOfLines={1} className="text-[13px] text-foreground">
            {reply.text}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
