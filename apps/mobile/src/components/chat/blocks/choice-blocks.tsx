import type {
  Block,
  RatingBlock as RatingBlockData,
  ChoiceBlock as ChoiceBlockData,
} from '@zilar/protocol';
import { type ReactNode, useState } from 'react';
import { AlertBlock } from '@/components/chat/blocks/alert-block';
import { ButtonsBlock } from '@/components/chat/blocks/buttons-block';
import { FormBlock } from '@/components/chat/blocks/form-block';
import { PollBlock } from '@/components/chat/blocks/poll-block';
import { Star } from 'lucide-react-native';
import { Pressable, View, type ViewStyle } from 'react-native';
import { KEY_DARK, useBlockRespond, WELL } from '@/components/chat/blocks/block-respond';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

// The board's raised segment (`PhoneChoices.dc.html:34`).
const SEGMENT_ON: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #333333, #1c1c1c)',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.6), 0 1px 0 rgba(0,0,0,.9), 0 2px 4px rgba(0,0,0,.7)',
};

/**
 * 15 · PICK ONE: the question and the segmented control. A tap sends
 * the 0-based index, then the regular @AI reply with the chosen option. The
 * server's merged `selected` leads; a local tap shows at once.
 */
function ChoiceBlock({ block }: { block: ChoiceBlockData }) {
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

/**
 * 17 · RATING: the prompt, then `max` dark square star keys filled up
 * to the choice. A tap sends a 1-based rating and the regular @AI reply
 * `n/max`. `selected` in the merged card is that 1-based rating: the server
 * copies `value.rating` straight into `selected` (`apply.ts`, `applyRating`).
 */
function RatingBlock({ block }: { block: RatingBlockData }) {
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

/** The interactive kinds the choice group draws on the phone. */
export const CHOICE_KINDS: ReadonlySet<Block['kind']> = new Set<Block['kind']>([
  'buttons',
  'poll',
  'choice',
  'form',
  'rating',
  'alert',
]);

/**
 * The choice group's one dispatch point: buttons (13), poll (14), pick one
 * (15), quick form (16), rating (17) and the alert rule (18), following the
 * board `docs/design/mockups/blocks/PhoneChoices.dc.html`.
 */
export function renderChoiceBlock(
  block: Extract<Block, { kind: 'buttons' | 'poll' | 'choice' | 'form' | 'rating' | 'alert' }>,
): ReactNode {
  switch (block.kind) {
    case 'buttons':
      return <ButtonsBlock block={block} />;
    case 'poll':
      return <PollBlock block={block} />;
    case 'choice':
      return <ChoiceBlock block={block} />;
    case 'form':
      return <FormBlock block={block} />;
    case 'rating':
      return <RatingBlock block={block} />;
    case 'alert':
      return <AlertBlock block={block} />;
  }
}
