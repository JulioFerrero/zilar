import { ChevronRight } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { CountBadge } from '@/components/ui/count-badge';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

type ListRowProps = {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  count?: number;
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  trailing?: ReactNode;
  disabled?: boolean;
  className?: string;
};

/**
 * A settings-style row: an optional leading node (an `IconTile`), a title, a
 * one-line muted subtitle, an optional count pill and a chevron. It renders a
 * `Pressable` when it acts, a plain `View` otherwise.
 */
export function ListRow({
  icon,
  title,
  subtitle,
  count,
  chevron = true,
  onPress,
  accessibilityLabel,
  trailing,
  disabled = false,
  className,
}: ListRowProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  const rowClass = cn(
    'flex-row items-center gap-3 px-3 py-2.5',
    onPress === undefined ? undefined : 'active:bg-surface-raised disabled:opacity-60',
    className,
  );
  const content = (
    <>
      {icon}
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text numberOfLines={1} className="mt-0.5 text-[13px] text-muted-foreground">
            {subtitle}
          </Text>
        )}
      </View>
      {count === undefined ? null : <CountBadge count={count} />}
      {trailing}
      {chevron ? <ChevronRight size={18} color={MUTED_FOREGROUND[scheme]} /> : null}
    </>
  );

  if (onPress === undefined) {
    return <View className={rowClass}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={disabled}
      onPress={onPress}
      className={rowClass}
    >
      {content}
    </Pressable>
  );
}
