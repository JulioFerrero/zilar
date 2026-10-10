import type { TopicStatus } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Menu, MenuRadioItem } from '@/components/ui/menu';
import { STATUS_DOT, STATUS_LABEL, STATUS_ORDER } from './stripModel';

interface StatusMenuProps {
  status: TopicStatus;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (next: TopicStatus) => void;
}

/** The status chip (dot + text) and its menu; changing closes it first. */
export function StatusMenu({ status, open, onToggle, onClose, onChange }: StatusMenuProps) {
  const chooseStatus = (next: TopicStatus): void => {
    onClose();
    if (next === status) {
      return;
    }
    onChange(next);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${STATUS_LABEL[status]}. Change status`}
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span
          className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status])}
          aria-hidden="true"
        />
        {STATUS_LABEL[status]}
      </button>
      <Menu
        open={open}
        onClose={onClose}
        label="Change status"
        closeLabel="Close status menu"
        className="top-full left-0 mt-1 min-w-[160px]"
      >
        {STATUS_ORDER.map((option) => (
          <MenuRadioItem
            key={option}
            checked={option === status}
            onSelect={() => chooseStatus(option)}
            className="text-[13px]"
          >
            <span
              className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[option])}
              aria-hidden="true"
            />
            {STATUS_LABEL[option]}
          </MenuRadioItem>
        ))}
      </Menu>
    </div>
  );
}
