import type { UiReaction } from '@zilar/chat-core';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { raisedPill } from '@/lib/depth';
import { interruptFiber, runLater } from '@zilar/client-core';
import { cn } from '@/lib/utils';

/** How long the "who reacted" line stays under the chips. */
const REACTORS_VISIBLE_MS = 3000;

export interface ReactionChipsProps {
  reactions: UiReaction[];
  outgoing: boolean;
  onToggle?: (emoji: string) => void;
}

function chipLabel(reaction: UiReaction): string {
  return reaction.mine
    ? `${reaction.emoji} ${reaction.count}, including you`
    : `${reaction.emoji} ${reaction.count}`;
}

// The raised reaction pills under a bubble. Mine use a brighter accent. With `onToggle` a chip is a toggle: tapping one I already reacted with clears it.
export function ReactionChips({ reactions, outgoing, onToggle }: ReactionChipsProps) {
  const [shown, setShown] = useState<{ emoji: string; names: string[] } | null>(null);

  useEffect(() => {
    if (shown === null) {
      return undefined;
    }
    const hide = runLater(REACTORS_VISIBLE_MS, () => setShown(null));
    return () => {
      interruptFiber(hide);
    };
  }, [shown]);

  if (reactions.length === 0) {
    return null;
  }

  return (
    <View className={cn('mt-1', outgoing ? 'self-end' : 'self-start')}>
      <View accessibilityRole="text" className="flex-row flex-wrap gap-1">
        {reactions.map((reaction) => {
          const togglable = onToggle !== undefined;
          return (
            <Pressable
              key={reaction.emoji}
              accessibilityLabel={chipLabel(reaction)}
              accessibilityHint="Long press to see who reacted"
              accessibilityState={{ selected: reaction.mine }}
              hitSlop={8}
              delayLongPress={350}
              onPress={() => onToggle?.(reaction.emoji)}
              onLongPress={() => setShown({ emoji: reaction.emoji, names: reaction.reactors })}
              className={cn(
                'flex-row items-center gap-1 rounded-full px-2 py-1',
                togglable ? 'active:opacity-80' : null,
                reaction.mine ? 'bg-[#ededed]' : null,
              )}
              style={reaction.mine ? null : raisedPill}
            >
              <Text className="text-[13px] leading-[17px]">{reaction.emoji}</Text>
              <Text
                className={cn(
                  'font-mono text-[11px] tabular-nums leading-none',
                  reaction.mine ? 'text-[#0a0a0a]' : 'text-muted-foreground',
                )}
              >
                {reaction.count}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {shown !== null ? (
        <Text
          numberOfLines={2}
          className={cn('mt-1 text-[12px] text-muted-foreground', outgoing ? 'self-end' : null)}
        >
          {shown.emoji} {shown.names.join(', ')}
        </Text>
      ) : null}
    </View>
  );
}
