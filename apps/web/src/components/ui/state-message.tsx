import { CircleAlert, Inbox, Loader2, type LucideIcon } from 'lucide-react';
import { Button } from './button';

export interface StateMessageProps {
  kind: 'empty' | 'loading' | 'error';
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
}

const ICONS = {
  empty: Inbox,
  error: CircleAlert,
} as const;

/** A centered empty, loading or error message with an optional action. */
export function StateMessage({ kind, title, hint, icon, action }: StateMessageProps) {
  const role = kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined;
  const Icon = kind === 'loading' ? undefined : (icon ?? ICONS[kind]);

  return (
    <div role={role} className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {kind === 'loading' ? (
        <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground" />
      ) : (
        Icon !== undefined && (
          <Icon
            aria-hidden="true"
            className={kind === 'error' ? 'size-5 text-danger' : 'size-5 text-muted-foreground'}
          />
        )
      )}
      <p className="text-[14px] font-medium text-foreground">{title}</p>
      {hint === undefined ? null : <p className="text-[13px] text-muted-foreground">{hint}</p>}
      {action === undefined ? null : (
        <Button className="mt-1" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
