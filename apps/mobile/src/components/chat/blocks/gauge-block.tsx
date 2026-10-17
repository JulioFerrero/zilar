import { gaugeArc } from '@zilar/chat-core';
import type { GaugeBlock as GaugeBlockData } from '@zilar/protocol';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// The board's ring (`PhoneNumbers.dc.html:149-153`): a `#0c0c0c` well track and
// an `#ededed` value arc of the same 9 px stroke, inside an 80 px box with a
// 76 px draw so the round cap never clips.
const ARC = { box: 80, radius: 32, stroke: 9, size: 76 };

/** 07 · GAUGE: a ratio ring with the label, value and caption beside it. */
export function GaugeBlock({ block }: { block: GaugeBlockData }) {
  const percent = Math.round(block.ratio * 100);
  return (
    <View className="flex-row items-center gap-4">
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${block.label}, ${percent} percent used`}
        className="h-[76px] w-[76px] shrink-0 items-center justify-center"
      >
        <Svg
          width={ARC.size}
          height={ARC.size}
          viewBox={`0 0 ${ARC.box} ${ARC.box}`}
          accessible={false}
        >
          <Circle
            cx={ARC.box / 2}
            cy={ARC.box / 2}
            r={ARC.radius}
            fill="none"
            stroke="#0c0c0c"
            strokeWidth={ARC.stroke}
          />
          <Path
            d={gaugeArc(block.ratio, ARC.radius)}
            transform={`translate(${ARC.box / 2} ${ARC.box / 2})`}
            fill="none"
            stroke="#ededed"
            strokeWidth={ARC.stroke}
            strokeLinecap="round"
          />
        </Svg>
        <Text
          className="absolute font-mono text-[15px] text-[#ededed]"
          style={TABULAR}
          numberOfLines={1}
        >
          {percent}%
        </Text>
      </View>
      <View className="min-w-0 flex-1 gap-[2px]">
        <Text className="text-[14px] text-[#a1a1a1]" numberOfLines={1}>
          {block.label}
        </Text>
        <Text className="font-mono text-[18px] leading-[26px]" style={TABULAR} numberOfLines={1}>
          {block.value}
        </Text>
        {block.caption === undefined ? null : (
          <Text className="text-[13px] text-[#8a8a8a]" numberOfLines={1}>
            {block.caption}
          </Text>
        )}
        {block.detail === undefined ? null : (
          <Text className="text-[13px] text-[#8a8a8a]" numberOfLines={1}>
            {block.detail}
          </Text>
        )}
      </View>
    </View>
  );
}
