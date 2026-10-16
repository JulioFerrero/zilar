import type { StatsBlock as StatsBlockData } from '@zilar/protocol';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';

// The board's recessed 6 px track and its light key fill
// (`docs/design/mockups/blocks/PhoneNumbers.dc.html:27-28`), the fill raised
// over a D24 well (`docs/design/ui-style.md:111-113`).
const TRACK: ViewStyle = {
  boxShadow:
    'inset 0 2px 6px rgba(0,0,0,.9), inset 0 1px 1px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.06)',
};
const FILL: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #f5f5f5, #b5b5b5)',
};

type Tile = StatsBlockData['tiles'][number];

// One tile: the `#101010` inner surface (README.md:30), a 12/10 label over the
// 18/24 mono value and the ratio bar.
function StatTile({ tile }: { tile: Tile }) {
  return (
    <View className="flex-1 gap-1.5 rounded-[12px] border border-[#1f1f1f] bg-[#101010] px-3 py-2.5">
      <Text className="text-[12px] text-[#a1a1a1]" numberOfLines={1}>
        {tile.label}
      </Text>
      <Text className="font-mono text-[18px] leading-[24px]" style={TABULAR} numberOfLines={1}>
        {tile.value}
      </Text>
      {tile.ratio === undefined ? (
        // The board keeps a tile without a ratio the same height with an empty
        // 6 px spacer (`PhoneNumbers.dc.html:79`).
        <View className="h-1.5" />
      ) : (
        <View className="h-1.5 overflow-hidden rounded-full bg-[#0c0c0c]" style={TRACK}>
          <View className="h-full rounded-full" style={[FILL, { width: `${tile.ratio * 100}%` }]} />
        </View>
      )}
    </View>
  );
}

/**
 * 03 · STAT TILES: up to six label/value tiles in the board's two-column grid,
 * each with a thin ratio bar when `ratio` is set. A lone last tile keeps the
 * half width. `showHeading` draws the block's own title when the card has no
 * header, as `ChecklistBlock` does.
 */
export function StatsBlock({
  block,
  showHeading,
}: {
  block: StatsBlockData;
  showHeading: boolean;
}) {
  const grid: Tile[][] = [];
  for (let index = 0; index < block.tiles.length; index += 2) {
    grid.push(block.tiles.slice(index, index + 2));
  }
  return (
    <View className="gap-2.5">
      {showHeading && block.title !== undefined ? (
        <Text className="text-[14px] font-medium text-[#a1a1a1]" numberOfLines={1}>
          {block.title}
        </Text>
      ) : null}
      {grid.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row gap-2">
          {row.map((tile, tileIndex) => (
            <StatTile key={tileIndex} tile={tile} />
          ))}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
}
