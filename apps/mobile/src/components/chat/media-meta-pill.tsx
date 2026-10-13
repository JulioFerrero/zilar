import { formatTime, type UiMessage } from '@zilar/chat-core';
import { View, type ViewStyle } from 'react-native';

import { Ticks } from '@/components/chat/ticks';
import { Text } from '@/components/ui/text';
import { SEEN } from '@/lib/colors';
import { cn } from '@/lib/utils';

/**
 * The dark translucent blob (T-1335): when a media message has no caption the
 * time and ticks sit on the photo, bottom-right, in white on
 * `rgba(0,0,0,0.45)`, like Telegram. The read ticks keep the bright seen colour.
 */
const PILL: ViewStyle = { backgroundColor: 'rgba(0,0,0,0.45)' };

export function MediaMetaPill({
  message,
  outgoing,
  className,
}: {
  message: UiMessage;
  outgoing: boolean;
  className?: string;
}) {
  return (
    <View
      className={cn('flex-row items-center gap-1 rounded-full px-2 py-0.5', className)}
      style={PILL}
    >
      <Text className="font-mono text-[11px] text-white">{formatTime(message.createdAt)}</Text>
      {outgoing ? (
        <Ticks
          status={message.status}
          color={message.status === 'read' ? SEEN : '#ffffff'}
          size={13}
        />
      ) : null}
    </View>
  );
}
