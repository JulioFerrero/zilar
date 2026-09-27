import { cn } from '@/lib/utils';
import * as React from 'react';
import { Pressable } from 'react-native';

type IconButtonProps = React.ComponentProps<typeof Pressable> & {
  /** Required: every icon button is announced to screen readers. */
  label: string;
};

export function IconButton({ label, className, ...props }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      className={cn(
        'h-10 w-10 items-center justify-center rounded-full active:bg-list-hover',
        className,
      )}
      {...props}
    />
  );
}
