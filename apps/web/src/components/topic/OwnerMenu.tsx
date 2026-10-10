import type { MentionMember, TopicOwner } from '@zilar/chat-core';
import { isAiJid } from '@zilar/protocol';
import { Menu, MenuRadioItem } from '@/components/ui/menu';
import { ownerIdFor } from './stripModel';

interface OwnerMenuProps {
  owner: TopicOwner | null;
  label: string;
  candidates: MentionMember[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (owner: TopicOwner | null) => void;
}

/** The owner chip and its picker of topic members and AIs. */
export function OwnerMenu({
  owner,
  label,
  candidates,
  open,
  onToggle,
  onClose,
  onChange,
}: OwnerMenuProps) {
  const chooseOwner = (next: TopicOwner | null): void => {
    onClose();
    const same =
      (next === null && owner === null) ||
      (next !== null && owner !== null && next.kind === owner.kind && next.id === owner.id);
    if (same) {
      return;
    }
    onChange(next);
  };

  const members = candidates.filter((member) => !isAiJid(member.jid));
  const aiCandidates = candidates.filter((member) => isAiJid(member.jid));

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}. Change owner`}
        onClick={onToggle}
        className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {label}
      </button>
      <Menu
        open={open}
        onClose={onClose}
        label="Change owner"
        closeLabel="Close owner picker"
        className="top-full left-0 mt-1 max-h-64 min-w-[180px] overflow-y-auto"
      >
        <MenuRadioItem
          checked={owner === null}
          onSelect={() => chooseOwner(null)}
          className="text-[13px]"
        >
          No owner
        </MenuRadioItem>
        {members.map((member) => {
          const userId = ownerIdFor(member.jid);
          return (
            <MenuRadioItem
              key={member.jid}
              checked={owner?.kind === 'user' && owner.id === userId}
              onSelect={() => chooseOwner({ kind: 'user', id: userId, name: member.name })}
              className="text-[13px]"
            >
              {member.name}
            </MenuRadioItem>
          );
        })}
        {aiCandidates.map((member) => {
          const aiId = ownerIdFor(member.jid);
          return (
            <MenuRadioItem
              key={member.jid}
              checked={owner?.kind === 'ai' && owner.id === aiId}
              onSelect={() => chooseOwner({ kind: 'ai', id: aiId, name: member.name })}
              className="text-[13px]"
            >
              {member.name} (AI)
            </MenuRadioItem>
          );
        })}
      </Menu>
    </div>
  );
}
