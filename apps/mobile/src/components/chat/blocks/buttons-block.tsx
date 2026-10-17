import type { ButtonsBlock as ButtonsBlockData } from '@zilar/protocol';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { KEY_DARK, KEY_LIGHT, useBlockRespond } from '@/components/chat/blocks/block-respond';
import { TABULAR } from '@/components/chat/blocks/figure-block';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type Action = ButtonsBlockData['actions'][number];

type Answer = {
  actionId?: string;
  label: string;
  at: Date;
  by?: string | undefined;
  mine: boolean;
};

/** The answered row the server merged in; `undefined` when the card is open. */
function chosenAnswer(block: ButtonsBlockData): Answer | undefined {
  const chosen = block.chosen;
  const action =
    chosen === undefined ? undefined : block.actions.find((item) => item.id === chosen.actionId);
  if (chosen === undefined || action === undefined) {
    return undefined;
  }
  return {
    actionId: action.id,
    label: action.label,
    at: new Date(chosen.at),
    by: chosen.by,
    mine: false,
  };
}

/** The board's `17:41` answer time: a fixed 24-hour clock. */
function clockTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * 13 · BUTTONS (T-1796): the text, then up to four keys — light or dark per the
 * action's `style`. A press answers the card and, once the route succeeds,
 * leaves the board's answered row: a green check, the chooser's wording and the
 * time. The recorded `chosen` action reopens the card answered for everyone.
 * Read-only without a respond context.
 */
export function ButtonsBlock({ block }: { block: ButtonsBlockData }) {
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
            {clockTime(answered.at)}
          </Text>
        </View>
      )}
    </View>
  );
}
