import { statusTone, type BlockTone } from '@zilar/chat-core';
import type { StatusBlock as StatusBlockData } from '@zilar/protocol';
import { Activity } from 'lucide-react-native';
import { View } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// The status dots from the boards: a colour with a soft ring, and the word the
// dot reads aloud (the visible row never spells the status out).
const DOT: Record<BlockTone, { background: string; ring: string; label: string }> = {
  positive: { background: '#22c55e', ring: 'rgba(34,197,94,.14)', label: 'Up' },
  warning: { background: '#fbbf24', ring: 'rgba(251,191,36,.14)', label: 'Warning' },
  negative: { background: '#ef4444', ring: 'rgba(239,68,68,.14)', label: 'Down' },
  info: { background: '#a1a1a1', ring: 'rgba(161,161,161,.14)', label: 'Status' },
  neutral: { background: '#a1a1a1', ring: 'rgba(161,161,161,.14)', label: 'Status' },
};

/**
 * 12 · STATUS LIST: a dot plus a value per row, never a word. `showHeading`
 * hides the block's own title row when the card already draws a header.
 */
export function StatusBlock({
  block,
  showHeading,
}: {
  block: StatusBlockData;
  showHeading: boolean;
}) {
  return (
    <View className="gap-1">
      {showHeading ? (
        <View className="min-h-6 flex-row items-center gap-2">
          <Activity size={16} color="#a1a1a1" aria-hidden />
          <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.title}
          </Text>
        </View>
      ) : null}
      {block.rows.map((row, index) => {
        const look = DOT[statusTone(row.status)];
        return (
          <View
            key={index}
            className={
              index === block.rows.length - 1
                ? 'min-h-[44px] flex-row items-center gap-3'
                : 'min-h-[44px] flex-row items-center gap-3 border-b border-[#1c1c1c]'
            }
          >
            <View
              accessibilityRole="image"
              accessibilityLabel={look.label}
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: look.background, boxShadow: `0 0 0 3px ${look.ring}` }}
            />
            <Text className="flex-1" numberOfLines={1}>
              {row.label}
            </Text>
            {row.value === undefined ? null : (
              <Text
                className="text-[13px] text-[#a1a1a1] font-mono"
                style={TABULAR}
                numberOfLines={1}
              >
                {row.value}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
