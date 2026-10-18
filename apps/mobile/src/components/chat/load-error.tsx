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

export function LoadError({ message, onRetry, className, style }: LoadErrorProps) {
  return (
    <View className={cn('flex-1 items-center justify-center gap-3 p-8', className)} style={style}>
      <Text className="text-center text-[15px] text-muted-foreground">{message}</Text>
      <RetryButton onPress={onRetry} />
    </View>
  );
}

export function LoadErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="flex-row items-center gap-2 rounded-full border border-divider bg-surface-raised py-1 pr-1 pl-3">
      <Text className="text-[13px] text-muted-foreground">{message}</Text>
      <RetryButton onPress={onRetry} className="h-8 px-3" />
    </View>
  );
}
