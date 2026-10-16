import { Trash2 } from 'lucide-react-native';
import { View } from 'react-native';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';

type SelectionDeleteConfirmProps = {
  visible: boolean;
  /** The selected messages a delete is allowed on (T-1666, web's rule). */
  deletable: readonly { senderName: string }[];
  /** A DM (not an AI chat). */
  isDm: boolean;
  /** Every deletable message is mine. */
  allMine: boolean;
  onCancel: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
};

/**
 * The select-mode delete confirm (T-1666), mirroring web's `SelectionBar` copy:
 * an `ActionSheet` offering both choices for a DM where everything is mine,
 * otherwise a kit `ConfirmDialog`. The parent ends select mode after the delete.
 */
export function SelectionDeleteConfirm({
  visible,
  deletable,
  isDm,
  allMine,
  onCancel,
  onDeleteForMe,
  onDeleteForEveryone,
}: SelectionDeleteConfirmProps) {
  const plural = deletable.length > 1;
  const title = plural ? 'Delete messages?' : 'Delete message?';

  if (isDm && allMine) {
    return (
      <ActionSheet visible={visible} onClose={onCancel} closeLabel="Cancel delete" title={title}>
        <View className="px-4 py-3">
          <Text className="text-[14px] leading-5 text-muted-foreground">
            {plural
              ? 'Delete them for you only, or for everyone in the chat.'
              : 'Delete it for you only, or for everyone in the chat.'}
          </Text>
        </View>
        <ActionSheetItem
          label="Delete for me"
          accessibilityLabel="Delete for me"
          onPress={onDeleteForMe}
          destructive
          icon={Trash2}
        />
        <ActionSheetItem
          label="Delete for everyone"
          accessibilityLabel="Delete for everyone"
          onPress={onDeleteForEveryone}
          destructive
          icon={Trash2}
        />
        <ActionSheetItem label="Cancel" accessibilityLabel="Cancel delete" onPress={onCancel} />
      </ActionSheet>
    );
  }

  const message = isDm
    ? plural
      ? 'This removes them from your chat only.'
      : `This removes it from your chat only. ${deletable[0]?.senderName ?? ''} still has it.`
    : plural
      ? 'This deletes them for everyone in the chat.'
      : 'This deletes it for everyone in the chat.';
  const confirmLabel = isDm ? 'Delete for me' : 'Delete';

  return (
    <ConfirmDialog
      visible={visible}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      busyLabel="Deleting…"
      busy={false}
      onCancel={onCancel}
      onConfirm={isDm ? onDeleteForMe : onDeleteForEveryone}
      cancelAccessibilityLabel="Cancel delete"
      confirmAccessibilityLabel={confirmLabel}
    />
  );
}
