import type { UiReaction } from '@galena/chat-core';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { raisedPill } from '@/lib/depth';
import { cn } from '@/lib/utils';

export interface ReactionChipsProps {
  reactions: UiReaction[];
  /** True for my own outgoing bubble, which aligns the chips to the right. */
  outgoing: boolean;
}

function chipLabel(reaction: UiReaction): string {
  return reaction.mine
    ? `${reaction.emoji} ${reaction.count}, including you`
    : `${reaction.emoji} ${reaction.count}`;
}

/**
 * The raised reaction pills under a bubble. Read-only here: the mobile
 * reaction picker and its toggle actions come later. Mine use a brighter
 * accent to match the chat-action sheet, but no state changes on press.
 */
export function ReactionChips({ reactions, outgoing }: ReactionChipsProps) {
  if (reactions.length === 0) {
    return null;
  }

  return (
    <View
      accessibilityRole="text"
      className={cn('mt-1 flex-row flex-wrap gap-1', outgoing ? 'self-end' : 'self-start')}
    >
      {reactions.map((reaction) => (
        <Pressable
          key={reaction.emoji}
          accessibilityLabel={chipLabel(reaction)}
          accessibilityState={{ selected: reaction.mine }}
          disabled
          className={cn(
            'flex-row items-center gap-1 rounded-full px-2 py-0.5',
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
      ))}
    </View>
  );
}
