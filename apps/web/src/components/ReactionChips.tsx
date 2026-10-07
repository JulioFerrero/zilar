import type { UiReaction } from '@zilar/chat-core';
import { Chip } from './ui/chip';
import { cn } from '@/lib/utils';

export interface ReactionChipsProps {
  reactions: UiReaction[];
  /** True for my own outgoing bubble, which aligns the chips to the right. */
  own: boolean;
  className?: string;
  onToggle: (emoji: string) => void;
}

function chipLabel(reaction: UiReaction): string {
  return reaction.mine
    ? `${reaction.emoji} ${reaction.count}, including you`
    : `${reaction.emoji} ${reaction.count}`;
}

/**
 * The raised reaction pills under a bubble (ui-style.md D24). Mine use the
 * pressed look. Each chip is a toggle button; its tooltip lists the reactors.
 */
export function ReactionChips({ reactions, own, className, onToggle }: ReactionChipsProps) {
  if (reactions.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'mt-1 flex max-w-full flex-wrap gap-1',
        own ? 'justify-end' : 'justify-start',
        className,
      )}
    >
      {reactions.map((reaction) => (
        <Chip
          key={reaction.emoji}
          pressed={reaction.mine}
          ariaLabel={chipLabel(reaction)}
          title={reaction.reactors.join(', ')}
          onClick={() => onToggle(reaction.emoji)}
          className={cn('reaction-chip', reaction.mine && 'reaction-chip-mine')}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {reaction.count}
          </span>
        </Chip>
      ))}
    </div>
  );
}
