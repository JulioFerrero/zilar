import { useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import type { Machine, PublicAi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { EntityAvatar } from '@/components/EntityAvatar';
import { ApprovedRow } from '@/components/machines/ApprovedRow';

interface MachineListRowProps {
  machine: Machine;
  /** The first of the owner's AIs whose home machine this is, for the row's avatar. */
  ai: PublicAi | undefined;
  /** Every AI whose home machine this is; null hides the line on the card. */
  aiNames: string[] | null;
  confirmingRevoke: boolean;
  onConfirm: (id: string | null) => void;
  onUpdate: (id: string, next: Machine) => void;
  onAisChanged: () => void;
}

/**
 * One approved machine in the list (T-1518): a status dot (online or offline),
 * the name, the first assigned AI's picture and a chevron. Clicking the row
 * opens a side sheet with today's machine card: rename, hardware, drivers,
 * fingerprint and Revoke. A revoke removes the machine from the approved list,
 * so the sheet closes with it.
 */
export function MachineListRow({
  machine,
  ai,
  aiNames,
  confirmingRevoke,
  onConfirm,
  onUpdate,
  onAisChanged,
}: MachineListRowProps) {
  const [open, setOpen] = useState(false);
  const online = machine.online === true;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[52px] w-full items-center gap-3 border-b border-divider px-4 text-left transition-colors last:border-b-0 hover:bg-list-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        <span
          role="img"
          aria-label={online ? 'Online' : 'Offline'}
          className={cn(
            'size-2 shrink-0 rounded-full',
            online ? 'bg-online' : 'bg-muted-foreground',
          )}
        />
        <span className="flex-1 truncate text-[15px] font-medium">{machine.name}</span>
        {ai !== undefined && (
          <EntityAvatar
            person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
            size={24}
            ai
          />
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} ariaLabel={machine.name}>
        <header className="flex shrink-0 items-center justify-end border-b border-divider p-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label="Close"
            title="Close"
            onClick={() => setOpen(false)}
            className="rounded-full text-muted-foreground"
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </header>
        <div className="flex-1 overflow-auto p-4">
          <ApprovedRow
            machine={machine}
            confirmingRevoke={confirmingRevoke}
            aiNames={aiNames}
            onConfirm={onConfirm}
            onUpdate={onUpdate}
            onAisChanged={onAisChanged}
          />
        </div>
      </Sheet>
    </>
  );
}
