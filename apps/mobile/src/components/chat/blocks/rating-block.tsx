import type { RatingBlock as RatingBlockData } from '@zilar/protocol';
import { Star } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { KEY_DARK, useBlockRespond } from '@/components/chat/blocks/block-respond';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

/**
 * 17 · RATING (T-1796): the prompt, then `max` dark square star keys filled up
 * to the choice. A tap sends a 1-based rating and the regular @AI reply
 * `n/max`. `selected` in the merged card is that 1-based rating: the server
 * copies `value.rating` straight into `selected` (`apply.ts`, `applyRating`).
 */
export function RatingBlock({ block }: { block: RatingBlockData }) {
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

  const press = (rating: number): void => {
    if (respond === null || respond.pending || selected === rating) {
      return;
    }
    const previous = selected;
    setSelected(rating);
    respond.submit({
      blockId: block.id,
      value: { rating },
      reply: `${rating}/${block.max}`,
      onSettled: (ok) => {
        if (!ok) {
          setSelected(previous);
        }
      },
    });
  };

  return (
    <View className="gap-2">
      <Text numberOfLines={3}>{block.prompt}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={block.prompt}
        className="flex-row gap-1.5"
      >
        {Array.from({ length: block.max }, (_, index) => {
          const rating = index + 1;
          const filled = selected !== undefined && rating <= selected;
          return (
            <Pressable
              key={rating}
              accessibilityRole="radio"
              accessibilityLabel={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
              accessibilityState={{ checked: filled, disabled }}
              disabled={disabled}
              onPress={() => press(rating)}
              className={cn(
                'h-10 w-10 items-center justify-center rounded-[12px]',
                disabled ? undefined : 'active:opacity-90',
              )}
              style={KEY_DARK}
            >
              <Star
                size={20}
                color={filled ? '#ededed' : '#5a5a5a'}
                fill={filled ? '#ededed' : 'none'}
                strokeWidth={1.6}
                aria-hidden
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
