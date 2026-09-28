import type * as React from 'react';
import { cn } from '@/lib/utils';

/** A recessed field or track: search, composer, segment track (ui-style.md §4). */
export function Well({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('well-surface', className)} {...props} />;
}
