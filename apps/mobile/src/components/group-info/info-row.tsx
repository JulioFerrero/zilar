import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Children, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { IconTile } from '@/components/ui/icon-tile';
import { Text } from '@/components/ui/text';
import { DANGER, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

type InfoRowProps = {
  icon: LucideIcon;
  label: string;
  count?: number | undefined;
  danger?: boolean | undefined;
  onPress: () => void;
  accessibilityLabel?: string | undefined;
};

export function InfoRow({
  icon: Icon,
  label,
  count,
  danger = false,
  onPress,
  accessibilityLabel,
}: InfoRowProps) {
  if (danger) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        onPress={onPress}
        className="min-h-[48px] flex-row items-center gap-3 px-3.5 active:bg-surface-raised"
      >
        <Icon size={18} color={DANGER} />
        <Text className="text-[15px] text-danger">{label}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      className="min-h-[48px] flex-row items-center gap-3 px-3 active:bg-surface-raised"
    >
      <IconTile>
        <Icon size={16} color={ICON} />
      </IconTile>
      <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
        {label}
      </Text>
      {count === undefined ? null : (
        <Text className="font-mono text-[13px] text-muted-foreground">{count}</Text>
      )}
      <ChevronRight size={14} color={MUTED_FOREGROUND} />
    </Pressable>
  );
}

export function InfoRowGroup({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <View className="overflow-hidden rounded-xl border border-border bg-surface">
      {items.map((child, index) => (
        <View key={index} className={cn(index > 0 && 'border-t border-divider')}>
          {child}
        </View>
      ))}
    </View>
  );
}
