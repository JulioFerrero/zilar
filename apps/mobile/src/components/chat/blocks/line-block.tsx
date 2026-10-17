import { compactNumber, linePath } from '@zilar/chat-core';
import type { LineBlock as LineBlockData } from '@zilar/protocol';
import { View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// The board's plot box (`PhoneNumbers.dc.html:129-132`): a 260-wide viewBox
// stretched to the card width, 110 tall, with three dashed rules at the quarter,
// half and three-quarter of the height.
const WIDTH = 260;
const HEIGHT = 110;
// Vertical breathing room so the line never clips when a bound sits on the box
// edge, the way the board insets its line (`:129-132`).
const PAD = 4;
const GRIDLINES = [0.25, 0.5, 0.75].map((fraction) => `M0 ${fraction * HEIGHT}H${WIDTH}`).join('');

/**
 * 06 · LINE: a sparkline with faint area fill, compact bounds and time labels.
 * `showHeading` draws the block's own title and value when the card has no
 * header, as `StatsBlock` does.
 */
export function LineBlock({ block, showHeading }: { block: LineBlockData; showHeading: boolean }) {
  const path = linePath(block.points, WIDTH, HEIGHT - PAD * 2, block.min, block.max);
  const area = path === '' ? '' : `${path} L ${WIDTH} ${HEIGHT - PAD} L 0 ${HEIGHT - PAD} Z`;
  const bounds =
    block.min !== undefined && block.max !== undefined ? { min: block.min, max: block.max } : null;
  const aria =
    [block.title, block.value].filter((part) => part !== undefined).join(', ') || 'Line chart';
  return (
    <View className="gap-2.5">
      {showHeading && (block.title !== undefined || block.value !== undefined) ? (
        <View className="flex-row items-center gap-2">
          <Text className="min-w-0 flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
            {block.title ?? ''}
          </Text>
          {block.value === undefined ? null : (
            <Text
              className="font-mono text-[13px] text-[#ededed]"
              style={TABULAR}
              numberOfLines={1}
            >
              {block.value}
            </Text>
          )}
        </View>
      ) : null}
      <View className="flex-row gap-2">
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={aria}
          className="min-w-0 flex-1"
        >
          <Svg
            width="100%"
            height={HEIGHT}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            preserveAspectRatio="none"
            accessible={false}
          >
            <Path
              d={GRIDLINES}
              stroke="#1f1f1f"
              strokeWidth={1}
              strokeDasharray="3 4"
              vectorEffect="non-scaling-stroke"
            />
            <G transform={`translate(0 ${PAD})`}>
              {area === '' ? null : <Path d={area} fill="rgba(237,237,237,.06)" />}
              <Path
                d={path}
                fill="none"
                stroke="#ededed"
                strokeWidth={1.6}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </G>
          </Svg>
        </View>
        {bounds === null ? null : (
          <View className="justify-between pt-[14px] pb-[12px]">
            <Text
              className="text-right font-mono text-[10px] text-[#8a8a8a]"
              style={TABULAR}
              numberOfLines={1}
            >
              {compactNumber(bounds.max)}
            </Text>
            <Text
              className="text-right font-mono text-[10px] text-[#8a8a8a]"
              style={TABULAR}
              numberOfLines={1}
            >
              {compactNumber(bounds.min)}
            </Text>
          </View>
        )}
      </View>
      {block.labels === undefined ? null : (
        <View
          className={
            bounds === null ? 'flex-row justify-between' : 'flex-row justify-between pr-[34px]'
          }
        >
          {block.labels.map((label, index) => (
            <Text
              key={`${label}-${index}`}
              className="min-w-0 font-mono text-[10px] text-[#8a8a8a]"
              numberOfLines={1}
            >
              {label}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
