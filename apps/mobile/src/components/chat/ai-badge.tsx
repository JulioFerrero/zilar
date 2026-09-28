import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { View } from 'react-native';

/** The Geist Mono `AI` badge from ui-style.md §2. */
export function AiBadge({ className }: { className?: string }) {
  return (
    <View className={cn('shrink-0 rounded-[5px] border border-badge-muted px-1', className)}>
      <Text className="font-mono text-[10px] leading-[15px] text-muted-foreground">AI</Text>
    </View>
  );
}
