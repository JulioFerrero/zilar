import { View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
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
  const action = ai === null ? null : runAction(ai);
  return (
    <ActionSheet
      visible={ai !== null}
      onClose={onClose}
      closeLabel="Close AI actions"
      error={runError}
      header={
        ai === null ? undefined : (
          <View className="flex-row items-center gap-3 px-4 py-3">
            <Avatar id={ai.id} name={ai.name} size={36} />
            <Text numberOfLines={1} className="min-w-0 flex-1 text-[16px] font-semibold">
              {ai.name}
            </Text>
          </View>
        )
      }
    >
      <ActionSheetItem label="Open chat" onPress={onOpenChat} />
      <ActionSheetItem label="Edit" onPress={onEdit} />
      {action !== null ? (
        <ActionSheetItem
          label={
            action === 'stop' ? (runBusy ? 'Stopping…' : 'Stop') : runBusy ? 'Resuming…' : 'Resume'
          }
          accessibilityLabel={action === 'stop' ? 'Stop AI' : 'Resume AI'}
          disabled={runBusy}
          onPress={() => onToggleRun(action)}
        />
      ) : null}
      <ActionSheetItem label="Delete" onPress={onDelete} destructive />
    </ActionSheet>
  );
}
