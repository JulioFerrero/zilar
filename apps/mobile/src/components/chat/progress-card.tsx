import type { Progress } from '@zilar/protocol';
import { ActivityIndicator, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT } from '@/lib/colors';
import { useColorScheme } from 'nativewind';

/** Stage text with a spinner and an optional progress bar. */
export function ProgressCard({ data }: { data: Progress }) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View className="min-w-[220px] gap-1.5 py-0.5">
      <View className="flex-row items-center gap-2">
        <ActivityIndicator size="small" color={ACCENT[scheme]} />
        <Text className="flex-1 text-[15px] font-semibold text-foreground">{data.stage}</Text>
        {data.percent === undefined ? null : (
          <Text className="font-mono text-[12px] text-muted-foreground">{data.percent}%</Text>
        )}
      </View>
      {data.detail ? (
        <Text className="text-[13px] leading-4 text-muted-foreground">{data.detail}</Text>
      ) : null}
      {data.percent === undefined ? null : (
        <View className="h-1 overflow-hidden rounded-full bg-[#0c0c0c]">
          <View className="h-1 rounded-full bg-accent" style={{ width: `${data.percent}%` }} />
        </View>
      )}
    </View>
  );
}
