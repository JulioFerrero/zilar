import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface CardProps {
  children: ReactNode;
  className?: string;
}

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

export function SectionLabel({
  children,
  as: As = 'h2',
}: {
  children: ReactNode;
  as?: 'h2' | 'h3' | 'p';
}) {
  return (
    <As className="m-0 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
      {children}
    </As>
  );
}
