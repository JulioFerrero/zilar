import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type SearchFieldProps = ComponentProps<'input'>;

export function SearchField({ className, ...props }: SearchFieldProps) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle-foreground"
        aria-hidden="true"
      />
      <input
        {...props}
        type="search"
        className={cn(
          'well-surface w-full rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-subtle-foreground disabled:pointer-events-none disabled:opacity-50',
          'pl-9',
        )}
      />
    </div>
  );
}
