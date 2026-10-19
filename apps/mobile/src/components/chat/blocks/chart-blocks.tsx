import type {
  Block,
  GaugeBlock as GaugeBlockData,
  BarsBlock as BarsBlockData,
  LineBlock as LineBlockData,
} from '@zilar/protocol';
import type { ReactNode } from 'react';
import { gaugeArc, barHeights, compactNumber, linePath } from '@zilar/chat-core';
import { View, type ViewStyle } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
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

function BlockHeading({
  block,
  valueClassName,
}: {
  block: { title?: string | undefined; value?: string | undefined };
  valueClassName: string;
}) {
  if (block.title === undefined && block.value === undefined) {
    return null;
  }
  return (
    <View className="flex-row items-center gap-2">
      <Text className="min-w-0 flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
        {block.title ?? ''}
      </Text>
      {block.value === undefined ? null : (
        <Text className={valueClassName} style={TABULAR} numberOfLines={1}>
          {block.value}
        </Text>
      )}
    </View>
  );
}

/**
 * 05 · BARS: a column per series entry, today's column raised and labelled.
 * `showHeading` draws the block's own title and total when the card has no
 * header, as `StatsBlock` does.
 */
function BarsBlock({ block, showHeading }: { block: BarsBlockData; showHeading: boolean }) {
  const heights = barHeights(block.series, PEAK_HEIGHT);
  const aria =
    [block.title, block.value].filter((part) => part !== undefined).join(', ') || 'Bar chart';
  return (
    <View className="gap-2.5">
      {showHeading ? (
        <BlockHeading block={block} valueClassName="font-mono text-[13px] text-[#a1a1a1]" />
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

// The board's ring (`PhoneNumbers.dc.html:149-153`): a `#0c0c0c` well track and
// an `#ededed` value arc of the same 9 px stroke, inside an 80 px box with a
// 76 px draw so the round cap never clips.
const ARC = { box: 80, radius: 32, stroke: 9, size: 76 };

/** 07 · GAUGE: a ratio ring with the label, value and caption beside it. */
function GaugeBlock({ block }: { block: GaugeBlockData }) {
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

/** The kinds the charts group draws on the phone. */
export const CHART_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>([
  'bars',
  'line',
  'gauge',
]);

/**
 * The charts group's one dispatch point: `bars` (05), `line` (06) and `gauge`
 * (07). The bodies follow the board
 * `docs/design/mockups/blocks/PhoneNumbers.dc.html`; each passes `showHeading`
 * through like the progress blocks do, except the gauge whose label is part of
 * its row.
 */
export function renderChartBlock(
  block: Extract<Block, { kind: 'bars' | 'line' | 'gauge' }>,
  showHeading: boolean,
): ReactNode {
  switch (block.kind) {
    case 'bars':
      return <BarsBlock block={block} showHeading={showHeading} />;
    case 'line':
      return <LineBlock block={block} showHeading={showHeading} />;
    case 'gauge':
      return <GaugeBlock block={block} />;
  }
}

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
function LineBlock({ block, showHeading }: { block: LineBlockData; showHeading: boolean }) {
  const path = linePath(block.points, WIDTH, HEIGHT - PAD * 2, block.min, block.max);
  const area = path === '' ? '' : `${path} L ${WIDTH} ${HEIGHT - PAD} L 0 ${HEIGHT - PAD} Z`;
  const bounds =
    block.min !== undefined && block.max !== undefined ? { min: block.min, max: block.max } : null;
  const aria =
    [block.title, block.value].filter((part) => part !== undefined).join(', ') || 'Line chart';
  return (
    <View className="gap-2.5">
      {showHeading ? (
        <BlockHeading block={block} valueClassName="font-mono text-[13px] text-[#ededed]" />
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
