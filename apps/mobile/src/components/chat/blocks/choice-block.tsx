import type { ChoiceBlock as ChoiceBlockData } from '@zilar/protocol';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { WELL, useBlockRespond } from '@/components/chat/blocks/block-respond';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

// The board's raised segment (`PhoneChoices.dc.html:34`).
const SEGMENT_ON: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #333333, #1c1c1c)',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.6), 0 1px 0 rgba(0,0,0,.9), 0 2px 4px rgba(0,0,0,.7)',
};

/**
 * 15 · PICK ONE (T-1796): the question and the segmented control. A tap sends
 * the 0-based index, then the regular @AI reply with the chosen option. The
 * server's merged `selected` leads; a local tap shows at once.
 */
export function ChoiceBlock({ block }: { block: ChoiceBlockData }) {
  const respond = useBlockRespond();
  const [selected, setSelected] = useState<number | undefined>(block.selected);
  // A room correction's `selected` wins; adjust during render rather than in an
  // effect, as `use-chat-screen.ts:131` does.
  const [selectedFrom, setSelectedFrom] = useState(block);
  if (selectedFrom !== block) {
    setSelectedFrom(block);
    setSelected(block.selected);
  }
  const disabled = respond === null || respond.pending;

  const press = (index: number, option: string): void => {
    if (respond === null || respond.pending || selected === index) {
      return;
    }
    const previous = selected;
    setSelected(index);
    respond.submit({
      blockId: block.id,
      value: { selected: index },
      reply: option,
      onSettled: (ok) => {
        if (!ok) {
          setSelected(previous);
        }
      },
    });
  };

  return (
    <View className="gap-2">
      <Text numberOfLines={3}>{block.question}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={block.question}
        className="flex-row gap-0.5 rounded-[10px] p-[3px]"
        style={WELL}
      >
        {block.options.map((option, index) => {
          const on = selected === index;
          return (
            <Pressable
              key={`${index}-${option}`}
              accessibilityRole="radio"
              accessibilityLabel={option}
              accessibilityState={{ checked: on, disabled }}
              disabled={disabled}
              onPress={() => press(index, option)}
              className={cn(
                'h-[34px] flex-1 items-center justify-center rounded-[7px]',
                disabled ? undefined : 'active:opacity-80',
              )}
              style={on ? SEGMENT_ON : undefined}
            >
              <Text
                className={cn('font-mono text-[14px]', on ? 'text-[#ededed]' : 'text-[#a1a1a1]')}
                numberOfLines={1}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
