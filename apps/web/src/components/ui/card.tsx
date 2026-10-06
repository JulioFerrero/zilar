import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/** A grouped surface whose direct rows are separated by hairline dividers. */
export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        'divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** An uppercase muted section label (11/600, 0.06em tracking). */
export function SectionLabel({
  children,
  as: As = 'h2',
}: {
  children: ReactNode;
  as?: 'h2' | 'h3' | 'p';
}) {
  return (
    <As className="m-0 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
      {children}
    </As>
  );
}
