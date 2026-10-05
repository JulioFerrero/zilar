import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';

import type { PublicAi } from '../../lib/ais-api';
import { runAction, type RunAction } from './run-state';

/**
 * Bottom sheet opened by tapping an AI row: Open chat / Edit / Delete, and the
 * T-0080 kill switch (Stop for `active`, Resume for `stopped`, nothing for
 * `disabled` — provisioning still in flight). Stop is reversible, so it does
 * not need a confirm step.
 */
export function AiActionsSheet({
  ai,
  onOpenChat,
  onEdit,
  onDelete,
  onToggleRun,
  runBusy,
  runError,
  onClose,
}: {
  ai: PublicAi | null;
  onOpenChat: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Called with the resolved action when the user taps Stop / Resume. */
  onToggleRun: (action: RunAction) => void;
  /** True while a Stop / Resume request is in flight. The button shows
   *  "Stopping…" / "Resuming…" and ignores taps so a double-tap can't send
   *  a second request. */
  runBusy: boolean;
  /** Inline error message rendered inside the sheet on a failed Stop/Resume;
   *  the sheet stays open so the owner can read it and retry. */
  runError: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const action = ai === null ? null : runAction(ai);
  return (
    <Modal visible={ai !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close AI actions"
        onPress={onClose}
        className="flex-1 justify-end bg-black/40 px-2"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}
      >
        <Pressable onPress={() => {}} className="overflow-hidden rounded-2xl bg-background">
          {ai !== null ? (
            <View className="flex-row items-center gap-3 border-b border-divider px-4 py-3">
              <Avatar id={ai.id} name={ai.name} size={36} />
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
                {ai.name}
              </Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open chat"
            onPress={onOpenChat}
            className="border-b border-divider px-4 py-3.5 active:bg-list-hover"
          >
            <Text className="text-[16px] text-foreground">Open chat</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit"
            onPress={onEdit}
            className="border-b border-divider px-4 py-3.5 active:bg-list-hover"
          >
            <Text className="text-[16px] text-foreground">Edit</Text>
          </Pressable>
          {action !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action === 'stop' ? 'Stop AI' : 'Resume AI'}
              disabled={runBusy}
              onPress={() => onToggleRun(action)}
              className="border-b border-divider px-4 py-3.5 active:bg-list-hover disabled:opacity-50"
            >
              <Text className="text-[16px] text-foreground">
                {action === 'stop'
                  ? runBusy
                    ? 'Stopping…'
                    : 'Stop'
                  : runBusy
                    ? 'Resuming…'
                    : 'Resume'}
              </Text>
            </Pressable>
          ) : null}
          {runError !== '' ? (
            <Text
              accessibilityRole="alert"
              className="border-b border-divider px-4 pb-3 pt-1 text-[13px] text-danger"
            >
              {runError}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete"
            onPress={onDelete}
            className="px-4 py-3.5 active:bg-list-hover"
          >
            <Text className="text-[16px] text-danger">Delete</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
