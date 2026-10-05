import { TextClassContext } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { KEY_PRIMARY_PRESSED_SHADOW, pressStyle, primaryKey } from '@/lib/depth';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { Platform, Pressable, type StyleProp, type ViewStyle } from 'react-native';

const buttonVariants = cva(
  cn(
    'group shrink-0 flex-row items-center justify-center gap-2 rounded-md shadow-none',
    Platform.select({
      web: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive whitespace-nowrap outline-none transition-all focus-visible:ring-[3px] disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    }),
  ),
  {
    variants: {
      variant: {
        // `default` and `key` both render the glossy primary key (ui-style.md §4).
        default: '',
        key: '',
        destructive: cn(
          'bg-destructive active:bg-destructive/90 dark:bg-destructive/60 shadow-sm shadow-black/5',
          Platform.select({
            web: 'hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
          }),
        ),
        outline: cn(
          'border-border-strong bg-surface active:bg-surface-raised dark:bg-surface border shadow-sm shadow-black/5',
          Platform.select({
            web: 'hover:bg-surface-raised',
          }),
        ),
        secondary: cn(
          'bg-secondary active:bg-secondary/80 shadow-sm shadow-black/5',
          Platform.select({ web: 'hover:bg-secondary/80' }),
        ),
        ghost: cn('active:bg-surface-raised', Platform.select({ web: 'hover:bg-surface-raised' })),
        link: '',
      },
      size: {
        default: cn('h-10 px-4 py-2 sm:h-9', Platform.select({ web: 'has-[>svg]:px-3' })),
        sm: cn('h-9 gap-1.5 rounded-md px-3 sm:h-8', Platform.select({ web: 'has-[>svg]:px-2.5' })),
        lg: cn('h-11 rounded-md px-6 sm:h-10', Platform.select({ web: 'has-[>svg]:px-4' })),
        icon: 'h-10 w-10 sm:h-9 sm:w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const buttonTextVariants = cva(
  cn(
    'text-foreground text-sm font-medium',
    Platform.select({ web: 'pointer-events-none transition-colors' }),
  ),
  {
    variants: {
      variant: {
        default: 'text-accent-foreground',
        key: 'text-accent-foreground',
        destructive: 'text-white',
        outline: cn(
          'group-active:text-foreground',
          Platform.select({ web: 'group-hover:text-foreground' }),
        ),
        secondary: 'text-secondary-foreground',
        ghost: 'group-active:text-foreground',
        link: cn(
          'text-accent group-active:underline',
          Platform.select({ web: 'underline-offset-4 hover:underline group-hover:underline' }),
        ),
      },
      size: {
        default: '',
        sm: '',
        lg: '',
        icon: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const KEY_VARIANTS = new Set(['default', 'key']);

type ButtonProps = Omit<React.ComponentProps<typeof Pressable>, 'style'> &
  React.RefAttributes<typeof Pressable> &
  VariantProps<typeof buttonVariants> & { style?: StyleProp<ViewStyle> };

function Button({ className, variant, size, style, onPressIn, onPressOut, ...props }: ButtonProps) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();
  const isKey = KEY_VARIANTS.has(variant ?? 'default');

  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        className={cn(props.disabled && 'opacity-50', buttonVariants({ variant, size }), className)}
        role="button"
        style={[
          isKey ? primaryKey : undefined,
          isKey ? pressStyle(pressed, KEY_PRIMARY_PRESSED_SHADOW, reduceMotion) : undefined,
          style,
        ]}
        onPressIn={(event) => {
          setPressed(true);
          onPressIn?.(event);
        }}
        onPressOut={(event) => {
          setPressed(false);
          onPressOut?.(event);
        }}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
