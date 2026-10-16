import { eventWhen } from '@zilar/chat-core';
import type { EventBlock as EventBlockData } from '@zilar/protocol';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// The raised date tile of the board (`PhoneContent.dc.html:125`).
const TILE: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #2c2c2c, #151515)',
  borderWidth: 1,
  borderColor: '#050505',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.16), 0 1px 0 rgba(0,0,0,.95)',
};

/**
 * 23 · EVENT: a date tile, the title and the time range in the viewer's zone.
 * The board's calendar and map keys are out of scope (Wave 2 and an uploaded
 * image), so the card is drawn without them.
 */
export function EventBlock({ block }: { block: EventBlockData }) {
  // The times are formatted in the zone the viewer is in, which is exactly what
  // an ISO timestamp has to be shown as (`eventWhen`).
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = eventWhen(block.startAt, block.endAt, timeZone);
  return (
    <View className="flex-row items-center gap-3">
      <View
        className="h-[54px] w-[50px] shrink-0 items-center justify-center rounded-[12px]"
        style={TILE}
      >
        <Text className="font-mono text-[10px] text-[#a1a1a1]">{when.month}</Text>
        <Text className="font-mono text-[21px] leading-[26px] font-semibold" style={TABULAR}>
          {when.day}
        </Text>
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-medium" numberOfLines={1}>
          {block.title}
        </Text>
        <Text className="text-[13px] text-[#a1a1a1]" numberOfLines={2}>
          {when.line}
          {block.detail === undefined ? '' : ` · ${block.detail}`}
        </Text>
      </View>
    </View>
  );
}
