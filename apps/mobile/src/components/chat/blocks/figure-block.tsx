import { changeTone, type BlockTone } from '@zilar/chat-core';
import type { Change, FigureBlock as FigureBlockData } from '@zilar/protocol';
import { View } from 'react-native';
import type { TextStyle } from 'react-native';

import { Text } from '@/components/ui/text';

// Geist Mono with tabular figures, as the boards draw every number (README.md:29).
export const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

// The change colours from the boards: up is `#4ade80` with ▲, down `#f87171`
// with ▼; flat keeps the muted meta colour. Shared with `NumberBlock` in
// `block-card.tsx`.
const CHANGE_COLOR: Record<BlockTone, string> = {
  positive: '#4ade80',
  negative: '#f87171',
  neutral: '#8a8a8a',
  warning: '#fbbf24',
  info: '#60a5fa',
};

/** The change's value colour, decided by its direction. */
export function changeColor(change: Change): string {
  return CHANGE_COLOR[changeTone(change)];
}

/** The change's label: ▲/▼ (never a lone arrow for a flat change) plus its text. */
export function changeLabel(change: Change): string {
  const arrow = change.direction === 'up' ? '▲' : change.direction === 'down' ? '▼' : '';
  return arrow === '' ? change.text : `${arrow} ${change.text}`;
}

/**
 * 01 · FIGURES: a label and a right-aligned value per row, with an optional
 * change column. Rows keep a change column the moment any row uses one, so the
 * values stay aligned, as the board's grid does.
 */
export function FigureBlock({ block }: { block: FigureBlockData }) {
  const hasChange = block.rows.some((row) => row.change !== undefined);
  return (
    <View className="gap-1.5">
      {block.rows.map((row, index) => (
        <View key={index} className="flex-row items-center gap-3">
          <Text className="flex-1" numberOfLines={1}>
            {row.label}
          </Text>
          <Text className="flex-1 text-right font-mono" style={TABULAR} numberOfLines={1}>
            {row.value}
          </Text>
          {hasChange ? (
            <Text
              className="w-16 text-right font-mono"
              style={[
                TABULAR,
                { color: row.change === undefined ? '#8a8a8a' : changeColor(row.change) },
              ]}
              numberOfLines={1}
            >
              {row.change === undefined ? '' : changeLabel(row.change)}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
