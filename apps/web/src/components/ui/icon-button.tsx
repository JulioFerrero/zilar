import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ComponentProps<'button'> {
  /** Square side in pixels. */
  size?: number;
  /** Corner radius in pixels. */
  radius?: number;
}

/** A dark, raised icon key (ui-style.md §4). Use with an `aria-label`. */
export function IconButton({
  className,
  size = 36,
  radius = 10,
  style,
  type = 'button',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      data-slot="icon-button"
      className={cn(
        'key-icon inline-flex shrink-0 items-center justify-center disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      style={{ width: size, height: size, borderRadius: radius, ...style }}
      {...props}
    >
      {children}
    </button>
  );
}
