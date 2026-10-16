import { ratioPercent } from '@zilar/chat-core';
import type { ProgressBlock as ProgressBlockData } from '@zilar/protocol';
import { CloudUpload } from 'lucide-react-native';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// The board's recessed track (`PhoneProgress.dc.html:25`) and its raised fill
// (`:26`): the D24 well recipe at the board's 8 px height (`:71`).
const TRACK: ViewStyle = {
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.05)',
};
const FILL: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg,#f5f5f5,#b5b5b5)',
};

/**
 * 09 · PROGRESS: one bar with the label, the percent and an optional detail and
 * note. `showHeading` hides the block's own label row when the card already
 * draws a header.
 */
export function ProgressBlock({
  block,
  showHeading,
}: {
  block: ProgressBlockData;
  showHeading: boolean;
}) {
  const percent = ratioPercent(block.ratio);
  const percentValue = Number.parseInt(percent, 10);
  return (
    <View className="gap-2.5">
      {showHeading ? (
        <View className="min-h-6 flex-row items-center gap-2">
          <CloudUpload size={16} color="#a1a1a1" aria-hidden />
          <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.label}
          </Text>
          <Text className="font-mono text-[14px] text-[#ededed]" style={TABULAR} numberOfLines={1}>
            {percent}
          </Text>
        </View>
      ) : null}
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={block.label}
        accessibilityValue={{ min: 0, max: 100, now: percentValue }}
        className="h-2 overflow-hidden rounded-full bg-[#0c0c0c]"
        style={TRACK}
      >
        <View className="h-full rounded-full" style={[FILL, { width: `${percentValue}%` }]} />
      </View>
      {block.detail === undefined && block.note === undefined ? null : (
        <View className="flex-row justify-between gap-3">
          {block.detail === undefined ? null : (
            <Text
              className="font-mono text-[13px] text-[#8a8a8a]"
              style={TABULAR}
              numberOfLines={1}
            >
              {block.detail}
            </Text>
          )}
          {block.note === undefined ? null : (
            <Text className="flex-1 text-right text-[13px] text-[#8a8a8a]" numberOfLines={1}>
              {block.note}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
