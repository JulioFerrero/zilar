import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Well({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('well-surface', className)} {...props} />;
}
