import { Circle, CircleDot, Globe, Lock, type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';

import type { PackVisibility } from './use-pack-editor';

/**
 * One visibility radio row. `VisibilityOption` replaces the two duplicated
 * radios the screen repeated (`split-rules.md` item 2, the in-file Dedup).
 */
export function VisibilityOption({
  icon: Icon,
  title,
  description,
  selected,
  disabled,
  accessibilityLabel,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-[52px] flex-row items-center gap-3 rounded-xl border px-3 py-2.5 ${
        selected ? 'border-border-strong bg-surface-raised' : 'border-border bg-surface'
      }`}
      style={{
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Icon size={18} color={ICON} />
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-medium text-foreground">{title}</Text>
        <Text className="text-[13px] text-muted-foreground">{description}</Text>
      </View>
      {selected ? <CircleDot size={20} color={ICON} /> : <Circle size={20} color={ICON} />}
    </Pressable>
  );
}

/** The pack's `Private` / `Shared on this server` choice. */
export function PackVisibilityField({
  value,
  disabled,
  imported,
  onChange,
}: {
  value: PackVisibility;
  disabled: boolean;
  imported: boolean;
  onChange: (next: PackVisibility) => void;
}) {
  return (
    <View className="gap-1">
      <Text className="text-[14px] font-medium text-foreground">Who can find this pack</Text>
      <VisibilityOption
        icon={Lock}
        title="Private"
        description="Only you can find a private pack. Stickers you already sent still show."
        selected={value === 'private'}
        disabled={disabled}
        accessibilityLabel="Private"
        onPress={() => onChange('private')}
      />
      <VisibilityOption
        icon={Globe}
        title="Shared on this server"
        description="Anyone on this server can find and add it."
        selected={value === 'server'}
        disabled={disabled}
        accessibilityLabel="Shared on this server"
        onPress={() => onChange('server')}
      />
      {imported ? (
        <Text className="text-[13px] text-muted-foreground">
          Imported packs are for personal use, so they stay private and cannot be shared.
        </Text>
      ) : null}
    </View>
  );
}
