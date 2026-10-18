import { View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Text } from '@/components/ui/text';

import type { PublicAi } from '../../lib/ais-api';
import { runAction, type RunAction } from './run-state';

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
  onToggleRun: (action: RunAction) => void;
  /** The button shows "Stopping…" / "Resuming…" and ignores taps so a double-tap cannot send a second request. */
  runBusy: boolean;
  /** The sheet stays open on failure so the owner can read the inline error and retry. */
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
            <EntityAvatar
              person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
              size={36}
            />
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
