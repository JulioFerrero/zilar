import { barHeights } from '@zilar/chat-core';
import type { BarsBlock as BarsBlockData } from '@zilar/protocol';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// The board's column look (`PhoneNumbers.dc.html:29-30`): dark raised bars, with
// today's bar on the light key gradient. Its value and label are drawn brighter
// too, so the highlight is never colour alone.
const BAR: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg,#333,#1c1c1c)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14), 0 1px 0 rgba(0,0,0,.9)',
};
const BAR_CURRENT: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg,#ffffff,#c8c8c8)',
  boxShadow: 'inset 0 1px 0 #fff, 0 1px 0 rgba(0,0,0,.9)',
};

// The tallest bar keeps headroom for its value label: the board draws the peak
// at 87% of the 120 px track (`:108-115`).
const TRACK_HEIGHT = 120;
const PEAK_HEIGHT = 87;

/**
 * 05 · BARS: a column per series entry, today's column raised and labelled.
 * `showHeading` draws the block's own title and total when the card has no
 * header, as `StatsBlock` does.
 */
export function BarsBlock({ block, showHeading }: { block: BarsBlockData; showHeading: boolean }) {
  const heights = barHeights(block.series, PEAK_HEIGHT);
  const aria =
    [block.title, block.value].filter((part) => part !== undefined).join(', ') || 'Bar chart';
  return (
    <View className="gap-2.5">
      {showHeading && (block.title !== undefined || block.value !== undefined) ? (
        <View className="flex-row items-center gap-2">
          <Text className="min-w-0 flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.title ?? ''}
          </Text>
          {block.value === undefined ? null : (
            <Text
              className="font-mono text-[13px] text-[#a1a1a1]"
              style={TABULAR}
              numberOfLines={1}
            >
              {block.value}
            </Text>
          )}
        </View>
      ) : null}
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={aria}
        className="flex-row items-end gap-2"
        style={{ height: TRACK_HEIGHT }}
      >
        {block.series.map((entry, index) => (
          <View
            key={`${entry.label}-${index}`}
            className="h-full min-w-0 flex-1 items-center justify-end gap-1"
          >
            <Text
              className={
                entry.current === true
                  ? 'font-mono text-[10px] text-[#ededed]'
                  : 'font-mono text-[10px] text-[#8a8a8a]'
              }
              style={TABULAR}
              numberOfLines={1}
            >
              {entry.value}
            </Text>
            <View
              className="w-full rounded-t-[6px] rounded-b-[3px]"
              style={[
                entry.current === true ? BAR_CURRENT : BAR,
                { height: `${heights[index] ?? 0}%` },
              ]}
            />
          </View>
        ))}
      </View>
      <View className="flex-row gap-2">
        {block.series.map((entry, index) => (
          <Text
            key={`${entry.label}-${index}`}
            className={
              entry.current === true
                ? 'min-w-0 flex-1 text-center font-mono text-[10px] text-[#ededed]'
                : 'min-w-0 flex-1 text-center font-mono text-[10px] text-[#8a8a8a]'
            }
            numberOfLines={1}
          >
            {entry.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
