import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import { cn } from '@/lib/utils';

export type ActionTile = {
  /** A stable key for the row. */
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
};

/**
 * One row of equal action tiles (ui-consistency.md §4.2): a 40 px `IconButton`
 * with a 12 px muted label below, shared by the own profile, the public profile
 * and the group and channel info pages.
 */
export function ActionTiles({
  items,
  accessibilityLabel,
}: {
  items: ActionTile[];
  accessibilityLabel?: string;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <View accessibilityLabel={accessibilityLabel} className="flex-row gap-2">
      {items.map(({ key, label, icon: Icon, onPress, disabled }) => (
        <View
          key={key}
          className={cn('flex-1 items-center gap-1.5', disabled === true && 'opacity-50')}
        >
          <IconButton label={label} disabled={disabled} onPress={onPress}>
            <Icon size={20} color={ICON} />
          </IconButton>
          <Text numberOfLines={1} className="text-[12px] text-muted-foreground">
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}
