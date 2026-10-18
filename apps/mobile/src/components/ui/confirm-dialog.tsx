import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { queueSheetTransition } from '@/components/ui/sheet-queue';
import { Text } from '@/components/ui/text';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  error?: string;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  confirmAccessibilityLabel?: string;
  cancelAccessibilityLabel?: string;
  destructive?: boolean;
  accessibilityLabel?: string;
};

export function ConfirmDialog({
  visible,
  title,
  message,
  error,
  confirmLabel,
  busyLabel,
  busy,
  onCancel,
  onConfirm,
  cancelLabel = 'Cancel',
  confirmAccessibilityLabel,
  cancelAccessibilityLabel,
  destructive = true,
  accessibilityLabel,
}: ConfirmDialogProps) {
  const hasError = error !== undefined && error !== '';
  // The dialog waits for a sheet that is still leaving: iOS cannot dismiss one
  // controller and present another at the same instant.
  const [shown, setShown] = useState(false);
  // A close hides it at once; adjust during render, as `block-card.tsx` does.
  if (!visible && shown) {
    setShown(false);
  }

  useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    void queueSheetTransition(() => {
      if (!cancelled) {
        setShown(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  return (
    <Modal
      visible={shown}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      accessibilityLabel={accessibilityLabel}
    >
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View className="w-full max-w-xs rounded-2xl border border-border-strong bg-surface p-4">
          <Text className="text-[16px] font-semibold text-foreground">{title}</Text>
          <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">{message}</Text>
          {hasError ? (
            <Text accessibilityRole="alert" className="mt-2 text-[13px] text-danger">
              {error}
            </Text>
          ) : null}
          <View className="mt-4 flex-row justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              accessibilityLabel={cancelAccessibilityLabel}
              onPress={onCancel}
            >
              <Text>{cancelLabel}</Text>
            </Button>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              size="sm"
              disabled={busy}
              accessibilityLabel={confirmAccessibilityLabel}
              onPress={onConfirm}
            >
              <Text>{busy ? busyLabel : confirmLabel}</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
