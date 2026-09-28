import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

// The primary key and the icon key carry their own focus ring (ui-style.md §4);
// the other variants use a plain ring.
const PLAIN_FOCUS = 'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 select-none items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'key-primary',
        outline: cn(
          'border-border-strong bg-surface text-foreground hover:bg-surface-raised',
          PLAIN_FOCUS,
        ),
        secondary: cn('bg-surface text-secondary-foreground hover:bg-surface-raised', PLAIN_FOCUS),
        ghost: cn('hover:bg-surface-raised hover:text-foreground', PLAIN_FOCUS),
        destructive: cn('bg-danger/10 text-danger hover:bg-danger/20', PLAIN_FOCUS),
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 gap-1.5 px-2.5',
        sm: 'h-7 gap-1 rounded-md px-2.5 text-[0.8rem]',
        lg: 'h-9 gap-1.5 px-3',
        icon: 'size-8',
        'icon-sm': 'size-7 rounded-md',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Component = asChild ? Slot.Root : 'button';

  return (
    <Component
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
