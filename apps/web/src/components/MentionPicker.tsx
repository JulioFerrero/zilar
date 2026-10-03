import { isAiJid, type MentionMember } from '@zilar/chat-core';
import { AiBadge } from './AiBadge';
import { Avatar } from './Avatar';
import { cn } from '@/lib/utils';

export interface MentionPickerProps {
  id: string;
  members: MentionMember[];
  activeIndex: number;
  onSelect: (member: MentionMember) => void;
  onHover: (index: number) => void;
}

/**
 * The `@` member picker shown above a group composer. It is a D24 surface card
 * (like the message actions menu); the textarea keeps focus, so the active row
 * is tracked with `aria-activedescendant`.
 */
export function MentionPicker({ id, members, activeIndex, onSelect, onHover }: MentionPickerProps) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label="Mention someone"
      className="absolute bottom-full left-0 z-30 mb-2 w-[264px] overflow-hidden rounded-[12px] border border-border-strong bg-surface py-1 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.9)]"
    >
      {members.map((member, index) => {
        const ai = isAiJid(member.jid);
        return (
          <button
            key={member.jid}
            id={optionId(member)}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            aria-label={
              member.handle === undefined ? member.name : `${member.name} @${member.handle}`
            }
            // Keep the textarea focused so typing and the keyboard keep working.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(member)}
            onMouseEnter={() => onHover(index)}
            className={cn(
              'flex w-full items-center gap-2 px-2 py-1.5 text-left text-[14px]',
              index === activeIndex ? 'bg-list-hover' : 'hover:bg-list-hover',
            )}
          >
            <Avatar id={member.jid} name={member.name} ai={ai} size={28} />
            <span className="min-w-0 flex-1 truncate">
              {member.name}
              {member.handle !== undefined && (
                <span className="ml-1 text-muted-foreground">@{member.handle}</span>
              )}
            </span>
            {ai && <AiBadge />}
          </button>
        );
      })}
    </div>
  );
}

function optionId(member: MentionMember): string {
  return `mention-option-${member.jid}`;
}
