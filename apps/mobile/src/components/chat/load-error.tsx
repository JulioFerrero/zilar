import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import { useKeyPress } from '@/components/ui/use-key-press';
import { KEY_ICON_PRESSED_SHADOW, iconKey, pressStyle } from '@/lib/depth';
import { cn } from '@/lib/utils';

type RetryButtonProps = {
  onPress: () => void;
  label?: string;
  className?: string;
};

/**
 * The Retry key: the raised dark key from `depth.ts` (§4), not the glossy
 * primary button, so a quiet failure stays quiet. Every key is announced.
 */
function RetryButton({ onPress, label = 'Retry', className }: RetryButtonProps) {
  const { pressed, reduceMotion, setPressed } = useKeyPress();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={cn('h-10 items-center justify-center rounded-xl px-4', className)}
      style={[iconKey, pressStyle(pressed, KEY_ICON_PRESSED_SHADOW, reduceMotion)]}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <Text className="text-[14px] font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}

type LoadErrorProps = {
  message: string;
  onRetry: () => void;
  className?: string;
  style?: StyleProp<ViewStyle>;
};

/** A centered failure with a Retry, for a list or a chat with nothing to show. */
export function LoadError({ message, onRetry, className, style }: LoadErrorProps) {
  return (
    <View className={cn('flex-1 items-center justify-center gap-3 p-8', className)} style={style}>
      <Text className="text-center text-[15px] text-muted-foreground">{message}</Text>
      <RetryButton onPress={onRetry} />
    </View>
  );
}

/** A thin inline bar over data that is still on screen, with a small Retry. */
export function LoadErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-divider px-3 py-2">
      <Text className="flex-1 text-[13px] text-muted-foreground">{message}</Text>
      <RetryButton onPress={onRetry} className="h-8 px-3" />
    </View>
  );
}
