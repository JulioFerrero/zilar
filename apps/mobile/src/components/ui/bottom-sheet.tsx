import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { sheetBottomPadding, useKeyboardHeight } from '@/lib/use-keyboard-height';

type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** The backdrop's accessibility label, e.g. "Close pins list". */
  closeLabel: string;
  /** A plain title row under the grab handle, when given. */
  title?: string;
  /** The sheet panel's max height class (default `'max-h-[85%]'`). */
  maxHeightClassName?: string;
  children?: ReactNode;
};

/**
 * The kit bottom sheet shell (T-0313, from T-0299/T-0310): a fade-in
 * `Modal`, a tappable backdrop that closes it and a rounded-top panel with
 * a grab handle, an optional title and scrollable content. The panel stays
 * above the keyboard: `KeyboardAvoidingView` pads it on iOS, and on Android
 * (edge-to-edge, Expo SDK 57) the panel is padded by the keyboard height on
 * top of the safe-area minimum.
 */
export function BottomSheet({
  visible,
  onClose,
  closeLabel,
  title,
  maxHeightClassName = 'max-h-[85%]',
  children,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <Pressable
          accessibilityLabel={closeLabel}
          onPress={onClose}
          className="flex-1 justify-end bg-black/40"
        >
          <Pressable
            onPress={() => {}}
            className={`${maxHeightClassName} rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3`}
            style={{
              paddingBottom: sheetBottomPadding(Platform.OS, insets.bottom, keyboardHeight),
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
              {title !== undefined ? (
                <Text
                  accessibilityRole="header"
                  className="text-[18px] font-semibold text-foreground"
                >
                  {title}
                </Text>
              ) : null}
              {children}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
