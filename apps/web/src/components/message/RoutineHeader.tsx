import type { RoutinePost } from '@zilar/protocol';
import { Repeat } from 'lucide-react';
import { Link } from 'react-router';

/**
 * T-1722: the header a routine's live message shows above its text (the
 * approved `WebRoutineLive` board): a repeat icon, the routine title in muted
 * 13 px medium and its schedule in mono 12 px. The whole row links to
 * Settings › Routines.
 */
export function RoutineHeader({ routine }: { routine: RoutinePost }) {
  return (
    <Link
      to="/settings/routines"
      className="flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground"
    >
      <Repeat className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{routine.title}</span>
      <span className="shrink-0 font-mono text-[12px]">{routine.schedule}</span>
    </Link>
  );
}
