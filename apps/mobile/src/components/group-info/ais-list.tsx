import { Effect } from 'effect';
import { Bot, MoreVertical, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { PersonPressable } from '@/components/chat/person-pressable';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { SectionLabel } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { GroupAi } from '@/lib/chat-api';
import { ICON } from '@/lib/colors';
import { useAction } from '@/lib/effect/use-action';
import { isWaiting } from '@zilar/client-core';
import { useChatStore } from '@/store/chat-store-provider';
import { failureOf } from '@zilar/client-core';

type AiWriteKind = 'add' | 'remove';

const WRITE_ERRORS: Record<AiWriteKind, string> = {
  add: 'Could not add the AI.',
  remove: 'Could not remove the AI.',
};

type AiWrite = { kind: AiWriteKind; call: () => Promise<unknown>; after?: () => void };

type GroupAisListProps = {
  groupId: string;
  ais: GroupAi[];
  isManager: boolean;
};

export function GroupAisList({ groupId, ais, isManager }: GroupAisListProps) {
  const me = useChatStore((state) => state.currentUserId);
  const ownedAis = useChatStore((state) => state.ownedAis);
  const addGroupAi = useChatStore((state) => state.addGroupAi);
  const removeGroupAi = useChatStore((state) => state.removeGroupAi);

  const [addOpen, setAddOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<GroupAi | undefined>(undefined);
  const [pendingRemove, setPendingRemove] = useState<GroupAi | undefined>(undefined);
  const [removeFor, setRemoveFor] = useState<GroupAi | undefined>(undefined);

  const [write, runWrite] = useAction((work: AiWrite) =>
    Effect.tryPromise({ try: work.call, catch: () => ({ kind: work.kind }) }).pipe(
      Effect.tap(() => Effect.sync(() => work.after?.())),
    ),
  );
  const busy = isWaiting(write);
  const failure = failureOf(write);
  const error = !busy && failure !== undefined ? WRITE_ERRORS[failure.kind] : '';

  const addable = ownedAis.filter((owned) => !ais.some((ai) => ai.aiId === owned.id));

  return (
    <View className="gap-2 px-4">
      <View className="flex-row items-center justify-between px-1">
        <SectionLabel>AIs</SectionLabel>
        <Text className="font-mono text-[13px] text-muted-foreground">{ais.length}</Text>
      </View>

      {ais.length === 0 ? (
        <StateMessage kind="empty" title="No AIs in this group yet." />
      ) : (
        <InfoRowGroup>
          {ais.map((ai) => (
            <View key={ai.aiId} className="min-h-[48px] flex-row items-center gap-3 px-3 py-2">
              <PersonPressable
                target={{ jid: ai.jid }}
                name={ai.name}
                className="min-w-0 flex-1 flex-row items-center gap-3"
              >
                <EntityAvatar
                  person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
                  size={40}
                  ai
                />
                <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
                  {ai.name}
                </Text>
              </PersonPressable>
              {ai.ownerId === me || isManager ? (
                <IconButton
                  label={`Options for ${ai.name}`}
                  className="h-9 w-9"
                  disabled={busy}
                  onPress={() => setMenuFor(ai)}
                >
                  <MoreVertical size={16} color={ICON} />
                </IconButton>
              ) : null}
            </View>
          ))}
        </InfoRowGroup>
      )}

      {isManager ? (
        <InfoRowGroup>
          <InfoRow icon={Bot} label="Add AI" onPress={() => setAddOpen(true)} />
        </InfoRowGroup>
      ) : null}

      {error === '' ? null : (
        <Text accessibilityRole="alert" className="pt-1 text-center text-[13px] text-danger">
          {error}
        </Text>
      )}

      <ActionSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        closeLabel="Close add AI"
        title="Add AI"
        error={failure?.kind === 'add' ? error : ''}
      >
        {addable.length === 0 ? (
          <Text className="px-4 py-3 text-[15px] text-muted-foreground">No AIs to add.</Text>
        ) : (
          addable.map((ai) => (
            <ActionSheetItem
              key={ai.id}
              label={ai.name}
              icon={Bot}
              disabled={busy}
              onPress={() =>
                runWrite({
                  kind: 'add',
                  call: () => addGroupAi(groupId, ai.id),
                  after: () => setAddOpen(false),
                })
              }
            />
          ))
        )}
      </ActionSheet>

      <ActionSheet
        visible={menuFor !== undefined}
        onClose={() => setMenuFor(undefined)}
        onDismissed={() => {
          if (pendingRemove !== undefined) {
            const ai = pendingRemove;
            setPendingRemove(undefined);
            setRemoveFor(ai);
          }
        }}
        closeLabel="Close AI options"
        title={menuFor?.name}
      >
        {menuFor !== undefined ? (
          <ActionSheetItem
            label="Remove"
            icon={Trash2}
            destructive
            onPress={() => {
              setPendingRemove(menuFor);
              setMenuFor(undefined);
            }}
          />
        ) : null}
      </ActionSheet>

      <ConfirmDialog
        visible={removeFor !== undefined}
        title={removeFor === undefined ? '' : `Remove ${removeFor.name}?`}
        message={
          removeFor === undefined
            ? ''
            : `${removeFor.name} will leave this group and stop reading its topics.`
        }
        confirmLabel="Remove"
        busyLabel="Removing…"
        busy={busy}
        error={removeFor !== undefined && failure?.kind === 'remove' ? error : ''}
        onCancel={() => setRemoveFor(undefined)}
        onConfirm={() => {
          if (removeFor !== undefined) {
            const ai = removeFor;
            runWrite({
              kind: 'remove',
              call: () => removeGroupAi(groupId, ai.aiId),
              after: () => setRemoveFor(undefined),
            });
          }
        }}
      />
    </View>
  );
}
