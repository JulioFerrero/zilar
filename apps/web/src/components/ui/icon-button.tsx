import type * as React from 'react';
import { cn } from '@/lib/utils';

export interface IconButtonProps extends React.ComponentProps<'button'> {
  /** Square side in pixels. */
  size?: number;
  /** Corner radius in pixels. */
  radius?: number;
  variant?: 'default' | 'primary';
}

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
