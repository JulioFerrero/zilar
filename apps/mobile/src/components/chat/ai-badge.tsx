import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { View } from 'react-native';

/** The small accent-outlined `AI` pill from ui-style.md §4. */
export function AiBadge({ className }: { className?: string }) {
  return (
    <View className={cn('rounded-full border border-accent px-1.5', className)}>
      <Text className="text-[11px] font-semibold leading-4 text-accent">AI</Text>
    </View>
  );
}
