import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { primaryKey, raisedPill } from '@/lib/depth';
import { cn } from '@/lib/utils';

export function UnreadBadge({ count, muted }: { count: number; muted: boolean }) {
  return (
    <View
      // A fresh view per look: RN 0.86 on Android crashes in draw when a live
      // view swaps one gradient style for another (device report 2026-10-04).
      key={muted ? 'muted' : 'live'}
      style={muted ? raisedPill : primaryKey}
      className="h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-1.5"
    >
      <Text
        className={cn(
          'text-[12px] font-semibold',
          muted ? 'text-foreground' : 'text-accent-foreground',
        )}
      >
        {count}
      </Text>
    </View>
  );
}
