import { sparklinePath } from '@zilar/chat-core';
import type { NumberBlock as NumberBlockData } from '@zilar/protocol';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { changeColor, changeLabel, TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// The board's sparkline box: a 300-wide viewBox stretched to the card width, 40
// tall, its points inset `CHART_PAD` from the edges.
const CHART_WIDTH = 300;
const CHART_HEIGHT = 40;
const CHART_PAD = 6;

/**
 * 02 · BIG NUMBER: the label and its code, one large value with an optional
 * change, and the change's sparkline. The line is green while the change is up
 * and red while it is down, the plain foreground colour without a change.
 */
export function NumberBlock({ block }: { block: NumberBlockData }) {
  const stroke = block.change === undefined ? '#ededed' : changeColor(block.change);
  const path =
    block.points === undefined
      ? ''
      : sparklinePath(block.points, CHART_WIDTH, CHART_HEIGHT, CHART_PAD);
  return (
    <View className="gap-2.5">
      <View className="flex-row items-center gap-2">
        <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
          {block.label}
        </Text>
        {block.code === undefined ? null : (
          <Text className="font-mono text-[12px]" numberOfLines={1}>
            {block.code}
          </Text>
        )}
      </View>
      <View className="flex-row flex-wrap items-baseline gap-2.5">
        <Text
          className="font-mono text-[32px] font-medium leading-[38px] tracking-[-0.02em]"
          style={TABULAR}
          numberOfLines={1}
        >
          {block.value}
        </Text>
        {block.change === undefined ? null : (
          <Text
            className="font-mono text-[13px]"
            style={[TABULAR, { color: changeColor(block.change) }]}
            numberOfLines={1}
          >
            {changeLabel(block.change)}
          </Text>
        )}
      </View>
      {path === '' ? null : (
        <Svg
          width="100%"
          height={CHART_HEIGHT}
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
          accessible={false}
        >
          <Path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </Svg>
      )}
    </View>
  );
}
