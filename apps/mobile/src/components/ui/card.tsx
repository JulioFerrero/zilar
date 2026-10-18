import { Children, type ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

export function Card({ children }: { children: ReactNode }) {
  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-surface">
      {Children.map(children, (child, index) => (
        <View className={index === 0 ? undefined : 'border-t border-divider'}>{child}</View>
      ))}
    </View>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Text
      accessibilityRole="header"
      className={cn(
        'px-1 text-[12px] font-medium uppercase tracking-[0.06em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </Text>
  );
}
