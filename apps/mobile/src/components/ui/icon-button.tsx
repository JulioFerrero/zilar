import { useKeyPress } from '@/components/ui/use-key-press';
import { KEY_ICON_PRESSED_SHADOW, iconKey, pressStyle } from '@/lib/depth';
import { cn } from '@/lib/utils';
import * as React from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

type IconButtonProps = Omit<React.ComponentProps<typeof Pressable>, 'style'> & {
  /** Required: every icon button is announced to screen readers. */
  label: string;
  style?: StyleProp<ViewStyle>;
};

/** A dark, raised icon key (ui-style.md §4): 12 px radius on mobile. */
export function IconButton({
  label,
  className,
  style,
  onPressIn,
  onPressOut,
  ...props
}: IconButtonProps) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      className={cn('h-10 w-10 items-center justify-center rounded-xl', className)}
      style={[iconKey, pressStyle(pressed, KEY_ICON_PRESSED_SHADOW, reduceMotion), style]}
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
  );
}
