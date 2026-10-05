import { Modal, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

/**
 * The two-step delete confirmation. A centered `Modal` dialog, not
 * `Alert.alert`: the app has no `Alert` anywhere, and its other confirmations
 * (`NewChatButton`, message actions) are Modals too.
 */
export function DeleteConfirmDialog({
  aiName,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  aiName: string | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={aiName !== null} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/40 p-6">
        <View className="w-full max-w-xs rounded-2xl bg-background p-4">
          <Text className="text-[16px] font-semibold text-foreground">
            Delete {aiName ?? 'AI'}?
          </Text>
          <Text className="mt-1 text-[14px] leading-5 text-muted-foreground">
            This removes the AI's chat account and its provider key.
          </Text>
          {error !== '' ? (
            <Text accessibilityRole="alert" className="mt-2 text-[13px] text-danger">
              {error}
            </Text>
          ) : null}
          <View className="mt-4 flex-row justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onPress={onCancel}>
              <Text>Cancel</Text>
            </Button>
            <Button variant="destructive" size="sm" disabled={busy} onPress={onConfirm}>
              <Text>{busy ? 'Removing…' : 'Remove'}</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
