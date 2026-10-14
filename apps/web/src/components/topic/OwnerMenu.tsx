import type { MentionMember, TopicOwner } from '@zilar/chat-core';
import { isAiJid } from '@zilar/protocol';
import { Menu, MenuRadioGroup, MenuRadioItem } from '@/components/ui/menu';
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

const NO_OWNER = 'none';

/** The picker value for an owner: `user:<id>` or `ai:<id>`, or `none`. */
function ownerValue(owner: TopicOwner | null): string {
  return owner === null ? NO_OWNER : `${owner.kind}:${owner.id}`;
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

  const chooseValue = (value: string): void => {
    if (value === NO_OWNER) {
      chooseOwner(null);
      return;
    }
    const sep = value.indexOf(':');
    const kind = value.slice(0, sep);
    const id = value.slice(sep + 1);
    const member = candidates.find((entry) => ownerIdFor(entry.jid) === id);
    const name = member?.name ?? '';
    chooseOwner(kind === 'ai' ? { kind: 'ai', id, name } : { kind: 'user', id, name });
  };

  const members = candidates.filter((member) => !isAiJid(member.jid));
  const aiCandidates = candidates.filter((member) => isAiJid(member.jid));

  return (
    <Menu
      open={open}
      onOpenChange={(next) => (next ? onToggle() : onClose())}
      label="Change owner"
      trigger={
        <button
          type="button"
          aria-label={`${label}. Change owner`}
          className="rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {label}
        </button>
      }
    >
      <MenuRadioGroup value={ownerValue(owner)} onValueChange={chooseValue}>
        <MenuRadioItem value={NO_OWNER} className="text-[13px]">
          No owner
        </MenuRadioItem>
        {members.map((member) => {
          const userId = ownerIdFor(member.jid);
          return (
            <MenuRadioItem key={member.jid} value={`user:${userId}`} className="text-[13px]">
              {member.name}
            </MenuRadioItem>
          );
        })}
        {aiCandidates.map((member) => {
          const aiId = ownerIdFor(member.jid);
          return (
            <MenuRadioItem key={member.jid} value={`ai:${aiId}`} className="text-[13px]">
              {member.name} (AI)
            </MenuRadioItem>
          );
        })}
      </MenuRadioGroup>
    </Menu>
  );
}
