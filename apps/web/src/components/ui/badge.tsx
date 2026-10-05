import { cn } from '@/lib/utils';

export interface BadgeProps {
  count: number;
  max?: number;
  muted?: boolean;
}

/** Unread-count pill (ui-style.md §5): a primary key pill, 20 px tall, 11/600. */
export function Badge({ count, max = 99, muted = false }: BadgeProps) {
  if (count <= 0) {
    return null;
  }
  const label = count > max ? `${max}+` : `${count}`;
  return (
    <span
      data-slot="badge"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold',
        muted ? 'bg-badge-muted text-foreground' : 'key-primary',
      )}
    >
      {label}
    </span>
  );
}
