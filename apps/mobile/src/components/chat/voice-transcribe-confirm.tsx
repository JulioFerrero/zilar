import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';

type TranscribeConfirmProps = {
  open: boolean;
  busy: boolean;
  onDownload: () => void;
  onClose: () => void;
};

/**
 * The one-time model download confirm (T-0179): "Download the transcription
 * model? 17 MB, once. Everything stays on your phone." with Download /
 * Cancel. A small sheet in the `attach-sheet.tsx` shape: a dim backdrop, a
 * rounded top panel, plain Download and Cancel actions, no emoji.
 */
export function VoiceTranscribeConfirm({
  open,
  busy,
  onDownload,
  onClose,
}: TranscribeConfirmProps) {
  const insets = useSafeAreaInsets();
  if (!open) {
    return null;
  }
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close transcription download"
        onPress={busy ? undefined : onClose}
        className="flex-1 justify-end bg-black/40"
      >
        <Pressable
          onPress={() => {}}
          accessibilityRole="menu"
          accessibilityLabel="Download the transcription model"
          className="rounded-t-2xl border-t border-border-strong bg-surface px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 8) }}
        >
          <View className="mb-1 h-1 w-10 self-center rounded-full bg-surface-raised" />
          <Text
            accessibilityRole="header"
            className="py-2 text-[17px] font-semibold text-foreground"
          >
            Download the transcription model?
          </Text>
          <Text className="pb-2 text-[14px] text-muted-foreground">
            17 MB, once. Everything stays on your phone.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Download transcription model"
            disabled={busy}
            onPress={onDownload}
            className="flex-row items-center justify-center rounded-[10px] bg-primary px-1 py-3 active:opacity-80 disabled:opacity-60"
          >
            <Text className="text-[16px] font-semibold text-primary-foreground">
              {busy ? 'Downloading…' : 'Download'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel transcription download"
            disabled={busy}
            onPress={onClose}
            className="mt-2 flex-row items-center justify-center rounded-[10px] px-1 py-3 active:bg-surface-raised disabled:opacity-60"
          >
            <Text className="text-[16px] text-muted-foreground">Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
