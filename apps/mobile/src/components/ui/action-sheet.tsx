import type { LucideIcon } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { Children, type ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

type ActionSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The backdrop's accessibility label, e.g. "Close AI actions". */
  closeLabel: string;
  /** A node rendered above the items. Beats `title` when both are set. */
  header?: ReactNode;
  /** A plain title row, when there is no `header`. */
  title?: string;
  children?: ReactNode;
  /** An alert line shown under the items, e.g. a failed action. */
  error?: string;
};

/**
 * The bottom action sheet shell: a fade-in `Modal`, a tappable backdrop that
 * closes it and a rounded card of `ActionSheetItem`s. The sheet owns the
 * dividers so a caller never manages borders by hand: a hairline between
 * items, none after the last one.
 */
export function ActionSheet({
  visible,
  onClose,
  closeLabel,
  header,
  title,
  children,
  error,
}: ActionSheetProps) {
  const insets = useSafeAreaInsets();
  const items = Children.toArray(children);
  const hasError = error !== undefined && error !== '';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel={closeLabel}
        onPress={onClose}
        className="flex-1 justify-end bg-black/40 px-2"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Pressable onPress={() => {}} className="overflow-hidden rounded-2xl bg-background">
          {header !== undefined ? (
            <View className="border-b border-divider">{header}</View>
          ) : title !== undefined ? (
            <View className="border-b border-divider px-4 py-3">
              <Text numberOfLines={1} className="text-[16px] font-semibold text-foreground">
                {title}
              </Text>
            </View>
          ) : null}
          {items.map((child, index) => (
            <View
              key={index}
              className={
                index < items.length - 1 || hasError ? 'border-b border-divider' : undefined
              }
            >
              {child}
            </View>
          ))}
          {hasError ? (
            <View className="px-4 py-2">
              <Text accessibilityRole="alert" className="text-[13px] text-danger">
                {error}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type ActionSheetItemProps = {
  label: string;
  /** Defaults to `label`. */
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  /** A lucide component, drawn at 18 px in the muted colour of the scheme. */
  icon?: LucideIcon;
  /** Renders the label in the danger colour. */
  destructive?: boolean;
  /** Indents the label, for a submenu such as the mute durations. */
  inset?: boolean;
};

/** A tappable row inside an `ActionSheet`; the sheet draws its dividers. */
export function ActionSheetItem({
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  icon: Icon,
  destructive = false,
  inset = false,
}: ActionSheetItemProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3.5 active:bg-list-hover disabled:opacity-50"
    >
      {Icon === undefined ? null : <Icon size={18} color={MUTED_FOREGROUND[scheme]} />}
      <Text
        className={cn(
          'text-[16px]',
          destructive ? 'text-danger' : 'text-foreground',
          inset ? 'pl-9' : undefined,
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
