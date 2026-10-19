// effect-plain: a presentational control; the block card owns the request.
import type {
  AlertBlock as AlertBlockData,
  Block,
  ButtonsBlock as ButtonsBlockData,
  PollBlock as PollBlockData,
  RatingBlock as RatingBlockData,
  ChoiceBlock as ChoiceBlockData,
} from '@zilar/protocol';
import { chosenAnswer, formatTime, type ChoiceAnswer as Answer } from '@zilar/chat-core';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { FormBlock } from '@/components/chat/blocks/form-block';
import { Bell, ChartColumn, Check, Star } from 'lucide-react-native';
import { Pressable, TextInput, View, type ViewStyle } from 'react-native';
import {
  FILL_DIM,
  FILL_LIGHT,
  KEY_DARK,
  KEY_LIGHT,
  TRACK,
  useBlockRespond,
  WELL,
} from '@/components/chat/blocks/block-respond';
import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';
import { myBlockPicks } from '@/lib/blocks-api';
import { cn } from '@/lib/utils';

// The board's raised segment (`PhoneChoices.dc.html:34`).
const SEGMENT_ON: ViewStyle = {
  experimental_backgroundImage: 'linear-gradient(180deg, #333333, #1c1c1c)',
  boxShadow:
    'inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.6), 0 1px 0 rgba(0,0,0,.9), 0 2px 4px rgba(0,0,0,.7)',
};

function useChoiceSelection(block: { selected?: number | undefined }) {
  const respond = useBlockRespond();
  const [selected, setSelected] = useState<number | undefined>(block.selected);
  // A room correction's `selected` wins; adjust during render rather than in an
  // effect, as `use-chat-screen.ts:131` does.
  const [selectedFrom, setSelectedFrom] = useState(block);
  if (selectedFrom !== block) {
    setSelectedFrom(block);
    setSelected(block.selected);
  }
  return { respond, selected, setSelected, disabled: respond === null || respond.pending };
}

/**
 * 15 · PICK ONE: the question and the segmented control. A tap sends
 * the 0-based index, then the regular @AI reply with the chosen option. The
 * server's merged `selected` leads; a local tap shows at once.
 */
function ChoiceBlock({ block }: { block: ChoiceBlockData }) {
  const { respond, selected, setSelected, disabled } = useChoiceSelection(block);

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
  const { respond, selected, setSelected, disabled } = useChoiceSelection(block);

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

/** The server accepts at most 120 characters per answer. */
const VALUE_MAX = 120;

const SWITCH_ON = {
  experimental_backgroundImage: 'linear-gradient(180deg, #ffffff, #d4d4d4)',
  boxShadow: 'inset 0 1px 0 #fff, 0 1px 2px rgba(0,0,0,.8)',
} as const;

const KNOB_ON = {
  experimental_backgroundImage: 'linear-gradient(180deg, #2c2c2c, #151515)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.16), 0 1px 2px rgba(0,0,0,.8)',
} as const;

/**
 * 18 · ALERT RULE: a bell and the title, then the value well and a
 * 50×30 switch, then the note. The answer is not a decision: the switch sends
 * `done` and the well sends `fields.value`, both without an @AI reply.
 */
function AlertBlock({ block }: { block: AlertBlockData }) {
  const respond = useBlockRespond();
  const [on, setOn] = useState(block.on);
  const [value, setValue] = useState(block.field.value);
  // The text this edit already sent, so the two commit events of one edit
  // (submit and end) send once.
  const sent = useRef<string | null>(null);
  // A room correction replaces both the switch and the value; adjust during
  // render rather than in an effect, as `rating-block.tsx` does.
  const [from, setFrom] = useState(block);
  if (from !== block) {
    setFrom(block);
    setOn(block.on);
    setValue(block.field.value);
  }
  const disabled = respond === null || respond.pending;

  const commitValue = (): void => {
    if (respond === null || respond.pending) {
      return;
    }
    const next = value.trim();
    if (next === '' || next === block.field.value || next === sent.current) {
      return;
    }
    const previous = block.field.value;
    sent.current = next;
    setValue(next);
    respond.submit({
      blockId: block.id,
      value: { fields: { value: next } },
      onSettled: (ok) => {
        sent.current = null;
        if (!ok) {
          setValue(previous);
        }
      },
    });
  };

  const toggle = (): void => {
    if (respond === null || respond.pending) {
      return;
    }
    const next = !on;
    const previous = on;
    setOn(next);
    respond.submit({
      blockId: block.id,
      value: { done: next },
      onSettled: (ok) => {
        if (!ok) {
          setOn(previous);
        }
      },
    });
  };

  return (
    <View className="gap-2.5">
      <View className="min-h-6 flex-row items-center gap-2">
        <Bell size={16} color="#a1a1a1" aria-hidden />
        <Text className="flex-1 text-[14px] font-medium text-[#a1a1a1]" numberOfLines={2}>
          {block.title}
        </Text>
      </View>
      <View className="flex-row items-center gap-2.5">
        <TextInput
          accessibilityLabel={block.field.label}
          editable={!disabled}
          value={value}
          onChangeText={setValue}
          onSubmitEditing={commitValue}
          onEndEditing={commitValue}
          maxLength={VALUE_MAX}
          className={cn(
            'h-10 flex-1 rounded-[12px] px-3 font-mono text-[14px] text-[#ededed]',
            disabled && 'opacity-60',
          )}
          style={WELL}
        />
        <Pressable
          key={on ? 'on' : 'off'}
          accessibilityRole="switch"
          accessibilityLabel={`${block.title}, ${block.field.label}`}
          accessibilityState={{ checked: on, disabled }}
          disabled={disabled}
          onPress={toggle}
          className="h-[30px] w-[50px] flex-row items-center rounded-full px-[3px]"
          style={[{ justifyContent: on ? 'flex-end' : 'flex-start' }, on ? SWITCH_ON : KEY_DARK]}
        >
          <View
            className="h-6 w-6 rounded-full"
            style={on ? KNOB_ON : { backgroundColor: '#8a8a8a' }}
          />
        </Pressable>
      </View>
      {block.note === undefined ? null : (
        <Text className="text-[13px] text-[#8a8a8a]" numberOfLines={2}>
          {block.note}
        </Text>
      )}
    </View>
  );
}

type Action = ButtonsBlockData['actions'][number];

/**
 * 13 · BUTTONS: the text, then up to four keys — light or dark per the
 * action's `style`. A press answers the card and, once the route succeeds,
 * leaves the board's answered row: a green check, the chooser's wording and the
 * time. The recorded `chosen` action reopens the card answered for everyone.
 * Read-only without a respond context.
 */
function ButtonsBlock({ block }: { block: ButtonsBlockData }) {
  const respond = useBlockRespond();
  const [answered, setAnswered] = useState<Answer | undefined>(() => chosenAnswer(block));
  const [seenChosen, setSeenChosen] = useState(block.chosen);

  // The room correction fills `chosen` in; a tap made in this view on the same
  // action keeps the "You chose" wording.
  if (block.chosen !== seenChosen) {
    setSeenChosen(block.chosen);
    const next = chosenAnswer(block);
    if (next !== undefined) {
      setAnswered((current) =>
        current !== undefined && current.actionId === next.actionId
          ? { ...next, mine: true }
          : next,
      );
    }
  }

  const press = (action: Action): void => {
    if (respond === null || respond.pending || answered !== undefined) {
      return;
    }
    setAnswered({ actionId: action.id, label: action.label, at: new Date(), mine: true });
    respond.submit({
      blockId: block.id,
      value: { actionId: action.id },
      reply: action.label,
      onSettled: (ok) => {
        if (!ok) {
          setAnswered(undefined);
        }
      },
    });
  };

  return (
    <View className="gap-2">
      <Text numberOfLines={4}>{block.text}</Text>
      {answered === undefined ? (
        <View className="flex-row flex-wrap gap-2">
          {block.actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              accessibilityState={{ disabled: respond === null }}
              disabled={respond === null || respond.pending}
              onPress={() => press(action)}
              className={cn(
                'h-10 items-center justify-center rounded-[12px] px-4',
                respond === null ? undefined : 'active:opacity-90',
              )}
              style={action.style === 'light' ? KEY_LIGHT : KEY_DARK}
            >
              <Text
                className={cn(
                  'text-[15px] font-medium',
                  action.style === 'light' ? 'text-[#0a0a0a]' : 'text-[#ededed]',
                )}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          <View className="h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#22c55e]">
            <Check size={12} color="#0a0a0a" aria-hidden />
          </View>
          <Text className="flex-1 text-[14px] text-[#a1a1a1]" numberOfLines={2}>
            {answered.mine ? 'You' : (answered.by ?? 'Someone')} chose{' '}
            <Text className="text-[#ededed]">{answered.label}</Text>
          </Text>
          <Text className="font-mono text-[12px] text-[#8a8a8a]" style={TABULAR}>
            {formatTime(answered.at)}
          </Text>
        </View>
      )}
    </View>
  );
}

type Option = PollBlockData['options'][number];

function votesOf(option: Option): number {
  return option.votes ?? 0;
}

/**
 * 14 · POLL: the bar-chart header with the question and the total,
 * then one 44 px row per option — label, count and the board's 6 px track. The
 * viewer's picks keep the light fill and a check; the rest stay dim. A tap
 * sends the whole answer (`multiple` toggles, a second single tap clears it).
 */
function PollBlock({ block }: { block: PollBlockData }) {
  const respond = useBlockRespond();
  const messageId = respond?.messageId;
  const tapped = useRef(false);
  const [mine, setMine] = useState<readonly string[]>([]);
  const total = block.votes ?? block.options.reduce((sum, option) => sum + votesOf(option), 0);
  const disabled = respond === null || respond.pending;

  // The card carries counts only, so the viewer's own picks come from
  // the server once. A tap before the answer lands wins over it.
  useEffect(() => {
    if (messageId === undefined) {
      return;
    }
    let active = true;
    void myBlockPicks(messageId)
      .then((picks) => {
        const own = picks[block.id];
        if (active && !tapped.current && own !== undefined) {
          setMine([...own]);
        }
      })
      .catch(() => {
        // The poll starts blank, as before; answering still works.
      });
    return () => {
      active = false;
    };
  }, [messageId, block.id]);

  const press = (option: Option): void => {
    if (respond === null || respond.pending) {
      return;
    }
    const previous = mine;
    tapped.current = true;
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
