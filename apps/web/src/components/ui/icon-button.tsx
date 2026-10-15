import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ComponentProps<'button'> {
  /** Square side in pixels. */
  size?: number;
  /** Corner radius in pixels. */
  radius?: number;
  /** `primary` draws the light accent key, `default` the dark one. */
  variant?: 'default' | 'primary';
}

/** An icon key (ui-style.md §4). Use with an `aria-label`. */
export function IconButton({
  className,
  size = 36,
  radius = 10,
  variant = 'default',
  style,
  type = 'button',
  title,
  children,
  ...props
}: IconButtonProps) {
  // A hover tooltip comes from the accessible name unless the caller sets one.
  const label = props['aria-label'];
  return (
    <button
      type={type}
      title={title ?? label}
      data-slot="icon-button"
      data-variant={variant}
      className={cn(
        variant === 'primary' ? 'key-primary' : 'key-icon',
        'inline-flex shrink-0 items-center justify-center disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      style={{ width: size, height: size, borderRadius: radius, ...style }}
      {...props}
    >
      {children}
    </button>
  );
}
