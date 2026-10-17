import type { PollBlock as PollBlockData } from '@zilar/protocol';
import { ChartColumn, Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  FILL_DIM,
  FILL_LIGHT,
  TRACK,
  useBlockRespond,
} from '@/components/chat/blocks/block-respond';
import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type Option = PollBlockData['options'][number];

function votesOf(option: Option): number {
  return option.votes ?? 0;
}

/**
 * 14 · POLL (T-1796): the bar-chart header with the question and the total,
 * then one 44 px row per option — label, count and the board's 6 px track. The
 * viewer's picks keep the light fill and a check; the rest stay dim. A tap
 * sends the whole answer (`multiple` toggles, a second single tap clears it).
 */
export function PollBlock({ block }: { block: PollBlockData }) {
  const respond = useBlockRespond();
  const [mine, setMine] = useState<readonly string[]>([]);
  const total = block.votes ?? block.options.reduce((sum, option) => sum + votesOf(option), 0);
  const disabled = respond === null || respond.pending;

  const press = (option: Option): void => {
    if (respond === null || respond.pending) {
      return;
    }
    const previous = mine;
    const multiple = block.multiple === true;
    const next = multiple
      ? mine.includes(option.id)
        ? mine.filter((id) => id !== option.id)
        : [...mine, option.id]
      : mine.includes(option.id)
        ? []
        : [option.id];
    setMine(next);
    respond.submit({
      blockId: block.id,
      value: { optionIds: [...next] },
      onSettled: (ok) => {
        if (!ok) {
          setMine(previous);
        }
      },
    });
  };

  return (
    <View className="gap-1">
      <View className="min-h-6 flex-row items-center gap-2">
        <ChartColumn size={16} color="#a1a1a1" aria-hidden />
        <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={2}>
          {block.question}
        </Text>
        <Text className="font-mono text-[12px] text-[#8a8a8a]" style={TABULAR}>
          {`${total} ${total === 1 ? 'vote' : 'votes'}`}
        </Text>
      </View>
      {block.options.map((option) => {
        const viewed = mine.includes(option.id);
        const share = total === 0 ? 0 : Math.min(100, (votesOf(option) / total) * 100);
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityLabel={`${option.label}, ${votesOf(option)} votes`}
            accessibilityState={{ disabled, selected: viewed }}
            disabled={disabled}
            onPress={() => press(option)}
            className={cn(
              'min-h-[44px] justify-center gap-1.5 py-1.5',
              disabled ? undefined : 'active:opacity-80',
            )}
          >
            <View className="flex-row items-center justify-between gap-2">
              <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
                <Text
                  className={cn('text-[15px] text-[#ededed]', viewed && 'font-medium')}
                  numberOfLines={1}
                >
                  {option.label}
                </Text>
                {viewed ? (
                  <View className="h-[15px] w-[15px] items-center justify-center rounded-full bg-[#ededed]">
                    <Check size={10} color="#0a0a0a" aria-hidden />
                  </View>
                ) : null}
              </View>
              <Text
                className={cn(
                  'font-mono text-[14px]',
                  viewed ? 'text-[#ededed]' : 'text-[#a1a1a1]',
                )}
                style={TABULAR}
              >
                {votesOf(option)}
              </Text>
            </View>
            <View className="h-1.5 overflow-hidden rounded-full bg-[#0c0c0c]" style={TRACK}>
              <View
                className="h-full rounded-full"
                style={[viewed ? FILL_LIGHT : FILL_DIM, { width: `${share}%` }]}
              />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
