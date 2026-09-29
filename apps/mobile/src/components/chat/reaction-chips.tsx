import type { UiReaction } from '@galena/chat-core';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { raisedPill } from '@/lib/depth';
import { cn } from '@/lib/utils';

export interface ReactionChipsProps {
  reactions: UiReaction[];
  /** True for my own outgoing bubble, which aligns the chips to the right. */
  outgoing: boolean;
  /** Toggling my reaction on an existing chip removes it (the long-press sheet
   *  shows the same emoji highlighted so the affordance is consistent). */
  onToggle?: (emoji: string) => void;
}

function chipLabel(reaction: UiReaction): string {
  return reaction.mine
    ? `${reaction.emoji} ${reaction.count}, including you`
    : `${reaction.emoji} ${reaction.count}`;
}

/**
 * The raised reaction pills under a bubble. Mine use a brighter accent to
 * match the chat-action sheet. With `onToggle` the chip is a toggle: tapping
 * a chip I already reacted with clears my reaction of that emoji.
 */
export function ReactionChips({ reactions, outgoing, onToggle }: ReactionChipsProps) {
  if (reactions.length === 0) {
    return null;
  }

  return (
    <View
      accessibilityRole="text"
      className={cn('mt-1 flex-row flex-wrap gap-1', outgoing ? 'self-end' : 'self-start')}
    >
      {reactions.map((reaction) => {
        const togglable = onToggle !== undefined;
        return (
          <Pressable
            key={reaction.emoji}
            accessibilityLabel={chipLabel(reaction)}
            accessibilityState={{ selected: reaction.mine }}
            disabled={!togglable}
            onPress={togglable ? () => onToggle(reaction.emoji) : undefined}
            className={cn(
              'flex-row items-center gap-1 rounded-full px-2 py-0.5',
              togglable ? 'active:opacity-80' : null,
              reaction.mine ? 'bg-[#ededed]' : null,
            )}
            style={reaction.mine ? null : raisedPill}
          >
            <Text className="text-[13px] leading-none">{reaction.emoji}</Text>
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
  );
}
