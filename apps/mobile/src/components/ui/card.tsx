import { Children, type ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';

/** A grouped surface whose direct children are separated by hairline dividers. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-surface">
      {Children.map(children, (child, index) => (
        <View className={index === 0 ? undefined : 'border-t border-divider'}>{child}</View>
      ))}
    </View>
  );
}

/** An uppercase muted section label (11/600, 0.08em tracking). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">
      {children}
    </Text>
  );
}
