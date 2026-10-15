import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { palette } from '@zilar/ui-tokens';
import type { LucideIcon } from 'lucide-react-native';
import { Children, useEffect, useRef, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { runInBackground } from '@/lib/effect/run-in-background';
import { cn } from '@/lib/utils';

type ActionSheetProps = {
  visible: boolean;
  onClose: () => void;
  /**
   * Fires after every native dismissal, whether a user dismissal or one the
   * `visible` effect asked for. A caller that hands off to another sheet
   * presents it here, so the two never present and dismiss in the same commit
   * (which leaves the next sheet without its dimmed backdrop).
   */
  onDismissed?: () => void;
  /**
   * The label for the sheet's drag handle (the kit used it for the backdrop).
   * Kept so the call sites don't change; see the T-1348 Report.
   */
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
 * The bottom action sheet shell (rebuilt on `@lodev09/react-native-true-sheet`
 * in T-1348): the platform's own sheet, so it slides up, drags down to close and
 * dims the backdrop (a tap outside closes it). The sheet owns the dividers so a
 * caller never manages borders by hand: a hairline between items, none after the
 * last one. `onDidDismiss` reports a user dismissal (drag, backdrop tap,
 * Android back) back to `onClose`; a dismissal the `visible` effect asks for is
 * not reported, so a caller that swaps one sheet for another (for example a
 * delete confirm) is not closed by its own dismiss. `onDismissed` fires after
 * every dismissal, user or programmatic, so a caller can present a follow-up
 * sheet only once this one has fully closed. The content's top padding
 * (`pt-6`) keeps its first row clear of the native grabber, which the library
 * draws inside the sheet's top edge and offers no content inset for.
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
  // Set when the `visible` effect dismisses the sheet itself, so `onDidDismiss`
  // can tell a programmatic dismissal from a user one (drag, backdrop, Android
  // back) and only report the latter to `onClose`.
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
      runInBackground(() => instance.present(), {});
    } else if (presented.current) {
      presented.current = false;
      dismissedByEffect.current = true;
      runInBackground(() => instance.dismiss(), {});
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
