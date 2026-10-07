import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface ChipProps {
  pressed?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  title?: string;
  tone?: 'neutral' | 'accent';
  className?: string;
  children: React.ReactNode;
}

/** A small pill button (`ui-style.md` §5): reactions, scope and filter chips. */
export function Chip({
  pressed,
  onClick,
  ariaLabel,
  title,
  tone = 'neutral',
  className,
  children,
}: ChipProps) {
  return (
    <button
      type="button"
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      data-slot="chip"
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        tone === 'accent' && 'bg-accent/20 font-medium text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}
