import { Forward } from 'lucide-react-native';
import { useEffect } from 'react';
import { BackHandler, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

/**
 * The bar shown while several messages are selected for forwarding (T-0445).
 * It replaces the composer: "N selected", Cancel and Forward (disabled while
 * nothing is checked). Android back leaves select mode.
 */
export function SelectionBar({
  count,
  onForward,
  onCancel,
}: {
  count: number;
  onForward: () => void;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => subscription.remove();
  }, [onCancel]);

  return (
    <View className="px-2 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
      <View className="flex-row items-center gap-3 rounded-[14px] bg-surface-raised px-4 py-2.5">
        <Text
          accessibilityLiveRegion="polite"
          numberOfLines={1}
          className="min-w-0 flex-1 text-[14px] text-muted-foreground"
        >
          {count} selected
        </Text>
        <Button variant="ghost" onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
        <Button disabled={count === 0} onPress={onForward}>
          <Forward size={16} />
          <Text>Forward</Text>
        </Button>
      </View>
    </View>
  );
}
