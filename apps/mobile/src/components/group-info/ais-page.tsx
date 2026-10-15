import { Effect } from 'effect';
import { Bot, ChevronLeft, MoreVertical, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconButton } from '@/components/ui/icon-button';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import type { GroupAi } from '@/lib/chat-api';
import { ICON } from '@/lib/colors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';

type AiWriteKind = 'add' | 'remove';

const WRITE_ERRORS: Record<AiWriteKind, string> = {
  add: 'Could not add the AI.',
  remove: 'Could not remove the AI.',
};

type AiWrite = { kind: AiWriteKind; call: () => Promise<unknown>; after?: () => void };

type AisPageProps = {
  groupId: string;
  ais: GroupAi[];
  isManager: boolean;
  onBack: () => void;
};

/**
 * The AIs page of Group info (T-1569): the group's AIs as orb rows with a ⋮
 * Remove (their owner or a manager), and an Add AI row for managers opening
 * the viewer's owned AIs not already in the group. Full screen with the root's
 * back key; the server enforces who may write.
 */
export function AisPage({ groupId, ais, isManager, onBack }: AisPageProps) {
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
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="h-14 flex-row items-center gap-2 px-3">
        <IconButton label="Back" onPress={onBack}>
          <ChevronLeft size={18} color={ICON} />
        </IconButton>
        <Text className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">AIs</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {ais.length === 0 ? (
          <StateMessage kind="empty" title="No AIs in this group yet." />
        ) : (
          <View className="px-4">
            <InfoRowGroup>
              {ais.map((ai) => (
                <View key={ai.aiId} className="min-h-[48px] flex-row items-center gap-3 px-3 py-2">
                  <EntityAvatar
                    person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
                    size={40}
                    ai
                  />
                  <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
                    {ai.name}
                  </Text>
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
          </View>
        )}

        {isManager ? (
          <View className="px-4 pt-3">
            <InfoRowGroup>
              <InfoRow icon={Bot} label="Add AI" onPress={() => setAddOpen(true)} />
            </InfoRowGroup>
          </View>
        ) : null}

        {error === '' ? null : (
          <Text accessibilityRole="alert" className="px-4 pt-3 text-center text-[13px] text-danger">
            {error}
          </Text>
        )}
      </ScrollView>

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
    </SafeAreaView>
  );
}
