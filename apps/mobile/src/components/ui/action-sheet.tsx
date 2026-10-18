import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { palette } from '@zilar/ui-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { Children, useEffect, useRef, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { queueSheetTransition } from '@/components/ui/sheet-queue';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

type ActionSheetProps = {
  visible: boolean;
  onClose: () => void;
  /**
   * Fires after every native dismissal, user or programmatic. A caller that hands
   * off to another sheet presents it here, so the two never present and dismiss in
   * the same commit (which leaves the next sheet without its dimmed backdrop).
   */
  onDismissed?: () => void;
  closeLabel: string;
  header?: ReactNode;
  title?: string;
  children?: ReactNode;
  error?: string;
};

/**
 * The bottom action sheet shell on `@lodev09/react-native-true-sheet`, with a
 * hairline between items: `onDidDismiss` reports only user dismissals, `onDismissed`
 * fires after any, and the content's `pt-6` clears the native grabber.
 */
export function ActionSheet({
  visible,
  onClose,
  onDismissed,
  closeLabel,
  header,
  title,
  children,
  error,
}: ActionSheetProps) {
  const sheet = useRef<TrueSheet>(null);
  const presented = useRef(false);
  // Set when the `visible` effect dismisses the sheet, so `onDidDismiss` can tell a
  // programmatic dismissal from a user one and only report the latter.
  const dismissedByEffect = useRef(false);
  const items = Children.toArray(children);
  const hasError = error !== undefined && error !== '';

  useEffect(() => {
    const instance = sheet.current;
    if (instance === null) {
      return;
    }
    if (visible) {
      presented.current = true;
      void queueSheetTransition(() => instance.present());
    } else if (presented.current) {
      presented.current = false;
      dismissedByEffect.current = true;
      void queueSheetTransition(() => instance.dismiss());
    }
  }, [visible]);

  return (
    <TrueSheet
      ref={sheet}
      detents={['auto']}
      backgroundColor={palette.surface}
      cornerRadius={16}
      grabber
      dimmed
      dismissible
      accessibilityOptions={{ grabberLabel: closeLabel }}
      onDidDismiss={() => {
        presented.current = false;
        const dismissedByVisible = dismissedByEffect.current;
        dismissedByEffect.current = false;
        if (!dismissedByVisible) {
          onClose();
        }
        onDismissed?.();
      }}
    >
      <View className="pb-2 pt-6">
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
            className={index < items.length - 1 || hasError ? 'border-b border-divider' : undefined}
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
      </View>
    </TrueSheet>
  );
}

type ActionSheetItemProps = {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: LucideIcon;
  destructive?: boolean;
  inset?: boolean;
};

export function ActionSheetItem({
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  icon: Icon,
  destructive = false,
  inset = false,
}: ActionSheetItemProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3.5 active:bg-list-hover disabled:opacity-50"
    >
      {Icon === undefined ? null : <Icon size={18} color={MUTED_FOREGROUND} />}
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
