import { View } from 'react-native';

import { Text } from '@/components/ui/text';

type CountBadgeProps = {
  count: number;
};

/** The accent count pill on a settings row; renders nothing at 0 or below. */
export function CountBadge({ count }: CountBadgeProps) {
  if (count <= 0) {
    return null;
  }
  return (
    <View className="min-w-[20px] items-center rounded-full bg-accent px-1.5 py-0.5">
      <Text className="text-[11px] font-semibold text-accent-foreground">{count}</Text>
    </View>
  );
}
